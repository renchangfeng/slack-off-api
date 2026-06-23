import {
  LeaderboardWindow,
  ProgressionPeriodType,
  RewardSourceType,
  RewardType
} from "@prisma/client";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { RuntimeConfig } from "../config/runtime.js";
import { registerConfig } from "../plugins/config.js";
import { registerObservability } from "../plugins/observability.js";
import { registerProgressionRoutes } from "./progression.js";

const userId = "11111111-1111-4111-8111-111111111111";
const periodId = "22222222-2222-4222-8222-222222222222";

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
  auth: { requireEmailVerified: false },
  checkIns: {
    minRewardDurationSeconds: 60,
    maxSessionSeconds: 60 * 45,
    dailyRewardedSessionCap: 5,
    scorePerEligibleMinute: 1,
    drawProgressPerSession: 1
  },
  beans: { drawProgressPerChance: 3 }
};

describe("progression routes", () => {
  it("returns numeric daily and weekly goal progress", async () => {
    const store = createStore({ completeDaily: false });
    const server = await buildTestServer(store);
    const response = await server.inject({
      method: "GET",
      url: "/v1/progression/summary",
      headers: { authorization: "Bearer test" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      level: 2,
      experience: 195,
      currentStreakDays: 3,
      dailyGoals: {
        completed: 1,
        total: 3,
        allCompleted: false,
        rewardClaimed: false,
        goals: [
          expect.objectContaining({ code: "check_in", current: 1, target: 1, completed: true }),
          expect.objectContaining({ code: "activity", current: 0, target: 1, completed: false }),
          expect.objectContaining({ code: "bean_draw", current: 0, target: 1, completed: false })
        ]
      },
      weeklyGoals: {
        completed: 3,
        total: 3,
        allCompleted: true,
        goals: [
          expect.objectContaining({ code: "rest_minutes", current: 65, target: 60 }),
          expect.objectContaining({ code: "activity", current: 5, target: 5 }),
          expect.objectContaining({ code: "active_days", current: 3, target: 3 })
        ]
      }
    });

    await server.close();
  });

  it("rejects an incomplete daily period", async () => {
    const store = createStore({ completeDaily: false });
    const server = await buildTestServer(store);
    const response = await server.inject({
      method: "POST",
      url: "/v1/progression/daily/claim",
      headers: { authorization: "Bearer test" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("GOAL_PERIOD_INCOMPLETE");
    expect(store.rewardLedger).toHaveLength(0);

    await server.close();
  });

  it("claims a completed weekly reward and reports a level up", async () => {
    const store = createStore({ completeDaily: true });
    const server = await buildTestServer(store);
    const response = await server.inject({
      method: "POST",
      url: "/v1/progression/weekly/claim",
      headers: { authorization: "Bearer test" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      period: "weekly",
      awarded: true,
      reward: {
        score: 50,
        drawProgress: 2,
        drawChancesGranted: 1
      },
      progression: {
        previousLevel: 2,
        currentLevel: 3,
        leveledUp: true
      }
    });
    expect(store.rewardLedger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: RewardSourceType.progression,
          rewardType: RewardType.score,
          amount: 50
        })
      ])
    );
    expect(store.score).toBe(245);

    const replay = await server.inject({
      method: "POST",
      url: "/v1/progression/weekly/claim",
      headers: { authorization: "Bearer test" }
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data.awarded).toBe(false);
    expect(replay.json().data.reward.score).toBe(0);
    expect(store.rewardLedger).toHaveLength(3);

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
  await server.register(registerProgressionRoutes);
  await server.ready();
  return server;
}

type TestStore = ReturnType<typeof createStore>;

function createStore({ completeDaily }: { completeDaily: boolean }) {
  const now = new Date();
  const day = 24 * 60 * 60 * 1000;
  return {
    score: 195,
    drawProgress: 1,
    drawChances: 0,
    claimedAt: null as Date | null,
    rewardLedger: [] as Array<Record<string, unknown>>,
    auditEvents: [] as Array<Record<string, unknown>>,
    checkIns: [
      { endedAt: now, eligibleDurationSeconds: 25 * 60 },
      { endedAt: new Date(now.getTime() - day), eligibleDurationSeconds: 20 * 60 },
      { endedAt: new Date(now.getTime() - 2 * day), eligibleDurationSeconds: 20 * 60 }
    ],
    activities: [
      ...(completeDaily ? [{ completedAt: now }] : []),
      { completedAt: new Date(now.getTime() - day) },
      { completedAt: new Date(now.getTime() - day - 1000) },
      { completedAt: new Date(now.getTime() - 2 * day) },
      { completedAt: new Date(now.getTime() - 2 * day - 1000) },
      { completedAt: new Date(now.getTime() - 2 * day - 2000) }
    ],
    beanDraws: completeDaily ? [{ createdAt: now }] : []
  };
}

function createPrismaMock(store: TestStore) {
  const prisma: Record<string, unknown> = {
    userStats: {
      findUnique: async () => ({
        totalSessions: 8,
        eligibleDurationSeconds: 42 * 60,
        currentStreakDays: 3,
        longestStreakDays: 5,
        drawProgress: store.drawProgress,
        drawChances: store.drawChances
      }),
      upsert: async ({ update }: { update: { drawProgress: number; drawChances: { increment: number } } }) => {
        store.drawProgress = update.drawProgress;
        store.drawChances += update.drawChances.increment;
      }
    },
    leaderboardScore: {
      findUnique: async () => ({ score: store.score }),
      upsert: async ({
        where,
        create,
        update
      }: {
        where: { userId_window_windowStart: { window: LeaderboardWindow } };
        create: { score: number };
        update: { score: { increment: number } };
      }) => {
        if (where.userId_window_windowStart.window === LeaderboardWindow.all_time) {
          store.score += update.score.increment ?? create.score;
        }
      }
    },
    activityAssignment: {
      count: async () => 6,
      findMany: async () => store.activities
    },
    beanInventory: {
      count: async () => 2
    },
    userAchievement: {
      count: async () => 3
    },
    checkInSession: {
      findMany: async () => store.checkIns
    },
    rewardLedger: {
      findMany: async () => store.beanDraws,
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
        store.rewardLedger.push(...data);
        return { count: data.length };
      }
    },
    progressionGoalPeriod: {
      findUnique: async () =>
        store.claimedAt
          ? {
              id: periodId,
              periodType: ProgressionPeriodType.weekly,
              claimedAt: store.claimedAt
            }
          : null,
      upsert: async ({ create }: { create: { periodType: ProgressionPeriodType; periodStart: Date } }) => ({
        id: periodId,
        userId,
        periodType: create.periodType,
        periodStart: create.periodStart,
        claimedAt: store.claimedAt
      }),
      updateMany: async () => {
        if (store.claimedAt) {
          return { count: 0 };
        }
        store.claimedAt = new Date();
        return { count: 1 };
      }
    },
    auditEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        store.auditEvents.push(data);
      }
    },
    $transaction: async <T>(fn: (tx: Record<string, unknown>) => Promise<T>) => fn(prisma)
  };
  return prisma;
}
