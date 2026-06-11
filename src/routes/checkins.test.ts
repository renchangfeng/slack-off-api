import { CheckInStatus, LeaderboardWindow } from "@prisma/client";
import Fastify from "fastify";
import { beforeEach, describe, expect, it } from "vitest";
import { registerConfig } from "../plugins/config.js";
import { registerObservability } from "../plugins/observability.js";
import type { RuntimeConfig } from "../config/runtime.js";
import { registerCheckInRoutes } from "./checkins.js";
import { registerLeaderboardRoutes } from "./leaderboards.js";

const userId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "22222222-2222-4222-8222-222222222222";

const runtimeConfig: RuntimeConfig = {
  rateLimits: {
    global: { max: 1000, timeWindow: "1 minute" },
    otp: { max: 1000, timeWindow: "1 minute" },
    checkIns: { max: 1000, timeWindow: "1 minute" },
    activities: { max: 1000, timeWindow: "1 minute" },
    beanDraws: { max: 1000, timeWindow: "1 minute" },
    leaderboardReads: { max: 1000, timeWindow: "1 minute" },
    profileUpdates: { max: 1000, timeWindow: "1 minute" }
  },
  auth: {
    requireEmailVerified: false
  },
  checkIns: {
    minRewardDurationSeconds: 60,
    maxSessionSeconds: 60 * 45,
    dailyRewardedSessionCap: 5,
    scorePerEligibleMinute: 1,
    drawProgressPerSession: 1
  },
  beans: {
    drawProgressPerChance: 3
  }
};

describe("check-in routes", () => {
  let store: TestStore;

  beforeEach(() => {
    store = createStore();
  });

  it("finishes an eligible session with stats, rewards, and audit event", async () => {
    const server = await buildTestServer(store);
    const startedAt = new Date(Date.now() - 5 * 60 * 1000);
    const session = store.addSession({ userId, startedAt });

    const response = await server.inject({
      method: "POST",
      url: `/v1/check-ins/${session.id}/finish`,
      headers: { authorization: "Bearer test" },
      payload: { idempotencyKey: "finish_eligible" }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.reward.rewarded).toBe(true);
    expect(body.data.reward.score).toBeGreaterThanOrEqual(5);
    expect(store.rewardLedger).toHaveLength(2);
    expect(store.leaderboardScores).toHaveLength(4);
    expect(store.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "check_in.finished",
          traceId: expect.stringMatching(/^trc_/)
        }),
        expect.objectContaining({
          eventType: "leaderboard.projected",
          requestId: expect.any(String)
        })
      ])
    );
    expect(store.stats.get(userId)).toMatchObject({
      totalSessions: 1,
      currentStreakDays: 1,
      longestStreakDays: 1
    });

    await server.close();
  });

  it("does not reward a session below the minimum rewarded duration", async () => {
    const server = await buildTestServer(store);
    const startedAt = new Date(Date.now() - 10 * 1000);
    const session = store.addSession({ userId, startedAt });

    const response = await server.inject({
      method: "POST",
      url: `/v1/check-ins/${session.id}/finish`,
      headers: { authorization: "Bearer test" },
      payload: {}
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.reward).toEqual({
      score: 0,
      drawProgress: 0,
      drawChancesGranted: 0,
      rewarded: false,
      achievementsUnlocked: []
    });
    expect(store.rewardLedger).toHaveLength(0);
    expect(store.sessions.get(session.id)).toMatchObject({
      status: CheckInStatus.completed,
      invalidReason: "BELOW_MIN_REWARD_DURATION",
      rewarded: false
    });

    await server.close();
  });

  it("does not let a user finish another user's session", async () => {
    const server = await buildTestServer(store);
    const session = store.addSession({
      userId: otherUserId,
      startedAt: new Date(Date.now() - 5 * 60 * 1000)
    });

    const response = await server.inject({
      method: "POST",
      url: `/v1/check-ins/${session.id}/finish`,
      headers: { authorization: "Bearer test" },
      payload: {}
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("CHECK_IN_NOT_FOUND");
    expect(store.sessions.get(session.id)).toMatchObject({
      status: CheckInStatus.active,
      rewarded: false
    });
    expect(store.rewardLedger).toHaveLength(0);

    await server.close();
  });

  it("returns leaderboard rows without private check-in timestamps or email", async () => {
    const server = await buildTestServer(store);
    const windowStart = todayUtc(new Date());
    store.addLeaderboardScore({
      userId: otherUserId,
      displayName: "榜一大哥",
      window: LeaderboardWindow.daily,
      windowStart,
      score: 20,
      equippedBadge: "摸鱼大王",
      equippedTitle: "工位哲学家"
    });
    store.addLeaderboardScore({
      userId,
      displayName: "tester",
      window: LeaderboardWindow.daily,
      windowStart,
      score: 5
    });

    const response = await server.inject({
      method: "GET",
      url: "/v1/leaderboards?window=daily&limit=1",
      headers: { authorization: "Bearer test" }
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.data.items).toHaveLength(1);
    expect(payload.data.items[0]).toMatchObject({
      rank: 1,
      displayName: "榜一大哥",
      equippedBadge: "摸鱼大王",
      equippedTitle: "工位哲学家",
      score: 20
    });
    expect(payload.data.currentUser).toMatchObject({
      rank: 2,
      userId,
      score: 5
    });
    expect(response.body).not.toContain("startedAt");
    expect(response.body).not.toContain("tester@example.com");

    await server.close();
  });
});

async function buildTestServer(store: TestStore) {
  const server = Fastify({ logger: false });
  server.decorate("prisma", createPrismaMock(store) as never);
  server.decorate("redis", null);
  await registerConfig(server, runtimeConfig);
  await registerObservability(server);
  server.decorateRequest("user");
  server.decorate("requireAuth", async (request) => {
    request.user = {
      id: userId,
      authSubject: userId,
      email: "tester@example.com",
      displayName: "tester"
    };
  });
  await server.register(registerCheckInRoutes);
  await server.register(registerLeaderboardRoutes);
  await server.ready();
  return server;
}

type TestSession = {
  id: string;
  userId: string;
  startedAt: Date;
  endedAt: Date | null;
  durationSeconds: number | null;
  eligibleDurationSeconds: number | null;
  status: CheckInStatus;
  invalidReason: string | null;
  rewarded: boolean;
  idempotencyKey: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type TestStats = {
  userId: string;
  totalSessions: number;
  totalDurationSeconds: number;
  eligibleDurationSeconds: number;
  currentStreakDays: number;
  longestStreakDays: number;
  lastEligibleCheckinDate: Date | null;
  drawChances: number;
  drawProgress: number;
  updatedAt: Date;
};

type TestStore = ReturnType<typeof createStore>;

function createStore() {
  let nextSessionId = 1;
  const sessions = new Map<string, TestSession>();
  const stats = new Map<string, TestStats>();
  const rewardLedger: unknown[] = [];
  const leaderboardScores: Array<{
    userId: string;
    displayName: string;
    window: string;
    windowStart: Date;
    score: number;
    equippedBadge?: string | null;
    equippedTitle?: string | null;
  }> = [];
  const auditEvents: Array<Record<string, unknown>> = [];

  return {
    sessions,
    stats,
    rewardLedger,
    leaderboardScores,
    auditEvents,
    addSession(input: { userId: string; startedAt: Date }) {
      const now = new Date();
      const session: TestSession = {
        id: `33333333-3333-4333-8333-${String(nextSessionId++).padStart(12, "0")}`,
        userId: input.userId,
        startedAt: input.startedAt,
        endedAt: null,
        durationSeconds: null,
        eligibleDurationSeconds: null,
        status: CheckInStatus.active,
        invalidReason: null,
        rewarded: false,
        idempotencyKey: null,
        createdAt: now,
        updatedAt: now
      };
      sessions.set(session.id, session);
      return session;
    },
    addLeaderboardScore(input: {
      userId: string;
      displayName: string;
      window: string;
      windowStart: Date;
      score: number;
      equippedBadge?: string | null;
      equippedTitle?: string | null;
    }) {
      leaderboardScores.push(input);
      return input;
    }
  };
}

function createPrismaMock(store: TestStore) {
  const prisma: Record<string, unknown> = {
    checkInSession: {
      findFirst: async ({ where }: { where: Partial<TestSession> }) =>
        [...store.sessions.values()].find(
          (session) =>
            (!where.userId || session.userId === where.userId) &&
            (!where.status || session.status === where.status)
        ) ?? null,
      findUnique: async ({ where }: { where: { id: string } }) =>
        store.sessions.get(where.id) ?? null,
      create: async ({ data }: { data: Partial<TestSession> & { userId: string; startedAt: Date } }) => {
        const session = store.addSession({
          userId: data.userId,
          startedAt: data.startedAt
        });
        session.idempotencyKey = data.idempotencyKey ?? null;
        return session;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<TestSession> }) => {
        const current = store.sessions.get(where.id);
        if (!current) {
          throw new Error("Session not found");
        }

        const updated = { ...current, ...data, updatedAt: new Date() };
        store.sessions.set(where.id, updated);
        return updated;
      },
      count: async ({ where }: { where: { userId: string; rewarded?: boolean; endedAt?: { gte: Date; lt: Date } } }) =>
        [...store.sessions.values()].filter(
          (session) =>
            session.userId === where.userId &&
            (where.rewarded === undefined || session.rewarded === where.rewarded) &&
            (!where.endedAt ||
              (session.endedAt !== null &&
                session.endedAt >= where.endedAt.gte &&
                session.endedAt < where.endedAt.lt))
        ).length
    },
    userStats: {
      findUnique: async ({ where }: { where: { userId: string } }) =>
        store.stats.get(where.userId) ?? null,
      upsert: async ({
        where,
        create,
        update
      }: {
        where: { userId: string };
        create: TestStats;
        update: Partial<Record<keyof TestStats, unknown>>;
      }) => {
        const current = store.stats.get(where.userId);
        if (!current) {
          store.stats.set(where.userId, {
            ...create,
            drawChances: create.drawChances ?? 0,
            updatedAt: new Date()
          });
          return store.stats.get(where.userId);
        }

        const next = { ...current };
        applyStatsUpdate(next, update);
        store.stats.set(where.userId, next);
        return next;
      }
    },
    achievement: {
      findMany: async () => []
    },
    userAchievement: {
      findMany: async () => []
    },
    beanInventory: {
      count: async () => 0
    },
    activityAssignment: {
      count: async () => 0
    },
    rewardLedger: {
      createMany: async ({ data }: { data: unknown[] }) => {
        store.rewardLedger.push(...data);
        return { count: data.length };
      }
    },
    leaderboardScore: {
      upsert: async ({
        where,
        create,
        update
      }: {
        where: {
          userId_window_windowStart: {
            userId: string;
            window: string;
            windowStart: Date;
          };
        };
        create: {
          userId: string;
          window: string;
          windowStart: Date;
          score: number;
        };
        update: {
          score: { increment: number };
        };
      }) => {
        const key = where.userId_window_windowStart;
        const existing = store.leaderboardScores.find(
          (score) =>
            score.userId === key.userId &&
            score.window === key.window &&
            score.windowStart.getTime() === key.windowStart.getTime()
        );

        if (existing) {
          existing.score += update.score.increment;
          return existing;
        }

        const score = {
          ...create,
          displayName: create.userId === userId ? "tester" : "榜一大哥",
          equippedBadge: null,
          equippedTitle: null
        };
        store.leaderboardScores.push(score);
        return score;
      },
      findMany: async ({
        where,
        take
      }: {
        where: { window: string; windowStart: Date };
        take: number;
      }) =>
        store.leaderboardScores
          .filter(
            (score) =>
              score.window === where.window &&
              score.windowStart.getTime() === where.windowStart.getTime()
          )
          .sort((left, right) => right.score - left.score)
          .slice(0, take)
          .map(serializeLeaderboardMock),
      findUnique: async ({
        where
      }: {
        where: {
          userId_window_windowStart: {
            userId: string;
            window: string;
            windowStart: Date;
          };
        };
      }) => {
        const key = where.userId_window_windowStart;
        const score = store.leaderboardScores.find(
          (item) =>
            item.userId === key.userId &&
            item.window === key.window &&
            item.windowStart.getTime() === key.windowStart.getTime()
        );
        return score ? serializeLeaderboardMock(score) : null;
      },
      count: async ({ where }: { where: { window: string; windowStart: Date; score: { gt: number } } }) =>
        store.leaderboardScores.filter(
          (score) =>
            score.window === where.window &&
            score.windowStart.getTime() === where.windowStart.getTime() &&
            score.score > where.score.gt
        ).length
    },
    auditEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        store.auditEvents.push(data);
        return data;
      }
    },
    $transaction: async <T>(fn: (tx: Record<string, unknown>) => Promise<T>) => fn(prisma)
  };

  return prisma;
}

function serializeLeaderboardMock(score: {
  userId: string;
  displayName: string;
  score: number;
  window: string;
  windowStart: Date;
  equippedBadge?: string | null;
  equippedTitle?: string | null;
}) {
  return {
    ...score,
    updatedAt: new Date(0),
    user: {
      displayName: score.displayName,
      profile: {
        equippedBadge: score.equippedBadge ? { name: score.equippedBadge } : null,
        equippedTitle: score.equippedTitle ? { name: score.equippedTitle } : null
      }
    }
  };
}

function todayUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function applyStatsUpdate(stats: TestStats, update: Partial<Record<keyof TestStats, unknown>>) {
  for (const [key, value] of Object.entries(update)) {
    if (isIncrement(value)) {
      const current = stats[key as keyof TestStats];
      if (typeof current === "number") {
        (stats as Record<string, unknown>)[key] = current + value.increment;
      }
      continue;
    }

    if (value !== undefined) {
      (stats as Record<string, unknown>)[key] = value;
    }
  }
}

function isIncrement(value: unknown): value is { increment: number } {
  return typeof value === "object" && value !== null && "increment" in value;
}
