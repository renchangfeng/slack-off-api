import {
  LeaderboardWindow,
  ProgressionPeriodType,
  RewardSourceType,
  RewardType
} from "@prisma/client";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { createTestRuntimeConfig } from "../config/test-utils.js";
import { registerConfig } from "../plugins/config.js";
import { registerObservability } from "../plugins/observability.js";
import type { ProgressionGoal, ProgressionGoalCode } from "../progression/goals.js";
import { buildProgressionNextActions, registerProgressionRoutes } from "./progression.js";

const userId = "11111111-1111-4111-8111-111111111111";
const periodId = "22222222-2222-4222-8222-222222222222";

const runtimeConfig = createTestRuntimeConfig();

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
      },
      nextActions: {
        0: expect.objectContaining({
          code: "claim_weekly_reward",
          targetSection: "home",
          rewardPreview: expect.objectContaining({ score: 50, drawProgress: 2 })
        }),
        1: expect.objectContaining({
          code: "complete_activity",
          targetSection: "activities"
        })
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
    expect(store.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "fish_tank.existing_loop.rejected",
          metadata: expect.objectContaining({
            sourceType: "daily_goal_claim",
            outcome: "rejected",
            reason: "GOAL_PERIOD_INCOMPLETE"
          })
        })
      ])
    );

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
    expect(response.json().data.fishTankOutcomes).toEqual([
      {
        resourceType: "hatch_progress",
        quantity: 2,
        label: "孵化进度",
        copy: "每周目标完成，孵化进度 +2。"
      }
    ]);
    expect(store.rewardLedger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: RewardSourceType.progression,
          rewardType: RewardType.score,
          amount: 50
        })
      ])
    );
    expect(store.fishTankResourceLedger.size).toBe(1);
    expect(store.score).toBe(245);
    expect(store.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "fish_tank.existing_loop.granted",
          sourceId: periodId,
          metadata: expect.objectContaining({
            sourceType: "weekly_goal_claim",
            outcome: "granted",
            resources: [{ resourceType: "hatch_progress", quantity: 2 }]
          })
        })
      ])
    );

    const replay = await server.inject({
      method: "POST",
      url: "/v1/progression/weekly/claim",
      headers: { authorization: "Bearer test" }
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data.awarded).toBe(false);
    expect(replay.json().data.reward.score).toBe(0);
    expect(replay.json().data.fishTankOutcomes).toEqual(response.json().data.fishTankOutcomes);
    expect(store.rewardLedger).toHaveLength(3);
    expect(store.fishTankResourceLedger.size).toBe(1);
    expect(store.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "fish_tank.existing_loop.replayed",
          sourceId: periodId,
          metadata: expect.objectContaining({
            sourceType: "weekly_goal_claim",
            outcome: "replayed",
            resources: [{ resourceType: "hatch_progress", quantity: 2 }]
          })
        })
      ])
    );

    await server.close();
  });

  it("rolls back claimed state, stats, reward rows, leaderboard score, and fish resources when fish grant fails", async () => {
    const store = createStore({ completeDaily: true });
    const server = await buildTestServer(store);
    store.fishTankGrantFailure = true;

    const response = await server.inject({
      method: "POST",
      url: "/v1/progression/weekly/claim",
      headers: { authorization: "Bearer test" }
    });

    expect(response.statusCode).toBe(500);
    expect(store.claimedAt).toBeNull();
    expect(store.rewardLedger).toHaveLength(0);
    expect(store.fishTankResourceLedger.size).toBe(0);
    expect(store.score).toBe(195);
    expect(store.drawProgress).toBe(1);
    expect(store.drawChances).toBe(0);
    expect(store.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "fish_tank.existing_loop.rolled_back",
          metadata: expect.objectContaining({
            sourceType: "weekly_goal_claim",
            outcome: "rolled_back",
            policyVersion: "v1",
            reason: "Error"
          })
        })
      ])
    );

    await server.close();
  });

  it("does not duplicate fish resources or rewards across concurrent claims", async () => {
    const store = createStore({ completeDaily: true });
    const server = await buildTestServer(store);

    const [first, second] = await Promise.all([
      server.inject({
        method: "POST",
        url: "/v1/progression/weekly/claim",
        headers: { authorization: "Bearer test" }
      }),
      server.inject({
        method: "POST",
        url: "/v1/progression/weekly/claim",
        headers: { authorization: "Bearer test" }
      })
    ]);

    expect([first.statusCode, second.statusCode].filter((code) => code === 200).length).toBeGreaterThanOrEqual(1);
    expect(store.fishTankResourceLedger.size).toBe(1);
    expect(store.rewardLedger).toHaveLength(3);
    expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
    expect(
      [first, second].map((response) => response.json().data.awarded).sort()
    ).toEqual([false, true]);
    expect(
      [first, second].map((response) => response.json().data.reward.score).sort((a, b) => a - b)
    ).toEqual([0, 50]);

    await server.close();
  });

  it("claims a completed daily reward with hatch progress", async () => {
    const store = createStore({ completeDaily: true });
    const server = await buildTestServer(store);
    const response = await server.inject({
      method: "POST",
      url: "/v1/progression/daily/claim",
      headers: { authorization: "Bearer test" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      period: "daily",
      awarded: true
    });
    expect(response.json().data.fishTankOutcomes).toEqual([
      {
        resourceType: "hatch_progress",
        quantity: 1,
        label: "孵化进度",
        copy: "每日目标完成，孵化进度 +1。"
      }
    ]);
    expect(store.fishTankResourceLedger.size).toBe(1);

    await server.close();
  });

  it("orders claimable daily rewards before follow-up gameplay actions", () => {
    const daily = periodState({
      completed: 3,
      total: 3,
      allCompleted: true,
      rewardClaimed: false,
      reward: { score: 15, drawProgress: 1 },
      goals: [
        goal("check_in", 1, 1),
        goal("activity", 1, 1),
        goal("bean_draw", 1, 1)
      ]
    });
    const weekly = periodState({
      completed: 1,
      total: 3,
      allCompleted: false,
      rewardClaimed: false,
      reward: { score: 50, drawProgress: 2 },
      goals: [
        goal("rest_minutes", 10, 60),
        goal("activity", 1, 5),
        goal("active_days", 1, 3)
      ]
    });

    const actions = buildProgressionNextActions(daily, weekly);

    expect(actions[0]).toMatchObject({
      code: "claim_daily_reward",
      actionLabel: "领取今日奖励",
      rewardPreview: { score: 15, drawProgress: 1, drawChances: 0 }
    });
  });

  it("guides unfinished daily goals in loop order", () => {
    const daily = periodState({
      completed: 1,
      total: 3,
      allCompleted: false,
      rewardClaimed: false,
      reward: { score: 15, drawProgress: 1 },
      goals: [
        goal("check_in", 1, 1),
        goal("activity", 0, 1),
        goal("bean_draw", 0, 1)
      ]
    });
    const weekly = periodState({
      completed: 0,
      total: 3,
      allCompleted: false,
      rewardClaimed: false,
      reward: { score: 50, drawProgress: 2 },
      goals: [
        goal("rest_minutes", 0, 60),
        goal("activity", 0, 5),
        goal("active_days", 0, 3)
      ]
    });

    expect(buildProgressionNextActions(daily, weekly).map((action) => action.code)).toEqual([
      "complete_activity",
      "draw_bean"
    ]);
  });
});

function goal(code: ProgressionGoalCode, current: number, target: number): ProgressionGoal {
  return {
    code,
    title: code,
    description: code,
    current,
    target,
    unit: code === "rest_minutes" ? "minutes" : code === "active_days" ? "days" : "times",
    completed: current >= target
  };
}

function periodState(input: {
  completed: number;
  total: number;
  allCompleted: boolean;
  rewardClaimed: boolean;
  reward: { score: number; drawProgress: number };
  goals: ReturnType<typeof goal>[];
}) {
  return {
    period: ProgressionPeriodType.daily,
    periodStart: new Date("2026-06-24T00:00:00.000Z"),
    periodEnd: new Date("2026-06-25T00:00:00.000Z"),
    claimedAt: null,
    ...input
  };
}

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
  let fishTankGrantFailure = false;
  return {
    score: 195,
    drawProgress: 1,
    drawChances: 0,
    claimedAt: null as Date | null,
    rewardLedger: [] as Array<Record<string, unknown>>,
    fishTankResourceLedger: new Map<string, Record<string, unknown>>(),
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
    beanDraws: completeDaily ? [{ createdAt: now }] : [],
    get fishTankGrantFailure() {
      return fishTankGrantFailure;
    },
    set fishTankGrantFailure(value: boolean) {
      fishTankGrantFailure = value;
    }
  };
}

type StoreSnapshot = {
  score: number;
  drawProgress: number;
  drawChances: number;
  claimedAt: Date | null;
  rewardLedger: Array<Record<string, unknown>>;
  fishTankResourceLedger: Map<string, Record<string, unknown>>;
  auditEvents: Array<Record<string, unknown>>;
};

function snapshotStore(store: TestStore): StoreSnapshot {
  return {
    score: store.score,
    drawProgress: store.drawProgress,
    drawChances: store.drawChances,
    claimedAt: store.claimedAt,
    rewardLedger: [...store.rewardLedger],
    fishTankResourceLedger: new Map(store.fishTankResourceLedger),
    auditEvents: [...store.auditEvents]
  };
}

function restoreStore(store: TestStore, snapshot: StoreSnapshot) {
  store.score = snapshot.score;
  store.drawProgress = snapshot.drawProgress;
  store.drawChances = snapshot.drawChances;
  store.claimedAt = snapshot.claimedAt;
  store.rewardLedger.length = 0;
  store.rewardLedger.push(...snapshot.rewardLedger);
  store.fishTankResourceLedger.clear();
  for (const [key, value] of snapshot.fishTankResourceLedger) {
    store.fishTankResourceLedger.set(key, value);
  }
  store.auditEvents.length = 0;
  store.auditEvents.push(...snapshot.auditEvents);
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
    fishTankResourceLedger: {
      upsert: async ({
        where,
        create
      }: {
        where: { userId_idempotencyKey: { userId: string; idempotencyKey: string } };
        create: Record<string, unknown>;
      }) => {
        if (store.fishTankGrantFailure) {
          throw new Error("Simulated fish tank grant failure");
        }
        const key = `${where.userId_idempotencyKey.userId}:${where.userId_idempotencyKey.idempotencyKey}`;
        const existing = store.fishTankResourceLedger.get(key);
        if (existing) {
          return existing;
        }
        const row = { ...create, createdAt: new Date() };
        store.fishTankResourceLedger.set(key, row);
        return row;
      },
      findMany: async ({
        where
      }: {
        where: {
          userId?: string;
          sourceType?: string;
          sourceId?: string | null;
          quantity?: { gt?: number };
        };
      }) => {
        return Array.from(store.fishTankResourceLedger.values()).filter((row: Record<string, unknown>) => {
          if (where.userId !== undefined && row.userId !== where.userId) return false;
          if (where.sourceType !== undefined && row.sourceType !== where.sourceType) return false;
          if (where.sourceId !== undefined && row.sourceId !== where.sourceId) return false;
          if (where.quantity?.gt !== undefined && !(typeof row.quantity === "number" && row.quantity > where.quantity.gt)) return false;
          return true;
        });
      }
    },
    progressionGoalPeriod: {
      findUnique: async () =>
        ({
          id: periodId,
          userId,
          periodType: ProgressionPeriodType.weekly,
          periodStart: new Date(),
          claimedAt: store.claimedAt
        }),
      createMany: async () => ({ count: 1 }),
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
    $transaction: async <T>(fn: (tx: Record<string, unknown>) => Promise<T>) => {
      const snapshot = snapshotStore(store);
      try {
        return await fn(prisma);
      } catch (error) {
        restoreStore(store, snapshot);
        throw error;
      }
    }
  };
  return prisma;
}
