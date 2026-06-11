import {
  AchievementRuleType,
  BeanRarity,
  CosmeticType,
  RewardSourceType,
  RewardType
} from "@prisma/client";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { evaluateAchievements } from "../achievements/evaluator.js";
import type { RuntimeConfig } from "../config/runtime.js";
import { registerConfig } from "../plugins/config.js";
import { registerObservability } from "../plugins/observability.js";
import { registerAchievementRoutes } from "./achievements.js";

const userId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "22222222-2222-4222-8222-222222222222";
const achievementId = "33333333-3333-4333-8333-333333333333";
const cosmeticId = "44444444-4444-4444-8444-444444444444";

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

describe("achievement and cosmetic flows", () => {
  it("unlocks achievements, awards cosmetic rewards, and stays idempotent", async () => {
    const store = createStore();
    const prisma = createPrismaMock(store);
    const trace = {
      requestId: "req_test",
      traceId: "trc_test",
      spanId: "spn_test"
    };

    const first = await evaluateAchievements(prisma as never, {
      userId,
      now: new Date("2026-06-11T00:00:00.000Z"),
      trace
    });
    const second = await evaluateAchievements(prisma as never, {
      userId,
      now: new Date("2026-06-11T00:00:01.000Z"),
      trace
    });

    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      code: "first_paid_pooping",
      rewards: {
        score: 10,
        cosmetic: "带薪蹲坑先锋"
      }
    });
    expect(second).toHaveLength(0);
    expect(store.userAchievements).toHaveLength(1);
    expect(store.userCosmetics).toHaveLength(1);
    expect(store.rewardLedger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: RewardSourceType.achievement,
          rewardType: RewardType.score
        }),
        expect.objectContaining({
          sourceType: RewardSourceType.achievement,
          rewardType: RewardType.cosmetic
        })
      ])
    );
    expect(store.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "achievement.unlocked",
          traceId: "trc_test"
        })
      ])
    );
  });

  it("equips only cosmetics owned by the authenticated user", async () => {
    const store = createStore();
    store.userCosmetics.push({
      userId,
      cosmeticId,
      unlockedAt: new Date(),
      sourceType: RewardSourceType.achievement
    });
    const server = await buildTestServer(store);

    const success = await server.inject({
      method: "POST",
      url: `/v1/cosmetics/${cosmeticId}/equip`,
      headers: { authorization: "Bearer test" }
    });
    const rejected = await server.inject({
      method: "POST",
      url: `/v1/cosmetics/${cosmeticId}/equip`,
      headers: { authorization: "Bearer test", "x-test-user-id": otherUserId }
    });

    expect(success.statusCode).toBe(200);
    expect(success.json().data.cosmetic).toMatchObject({
      id: cosmeticId,
      name: "带薪蹲坑先锋"
    });
    expect(store.profiles.get(userId)).toMatchObject({
      equippedBadgeId: cosmeticId
    });
    expect(rejected.statusCode).toBe(404);
    expect(rejected.json().error.code).toBe("COSMETIC_NOT_FOUND");

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
    const headerUserId = request.headers["x-test-user-id"]?.toString() ?? userId;
    request.user = {
      id: headerUserId,
      authSubject: headerUserId,
      email: `${headerUserId}@example.com`,
      displayName: "tester"
    };
  });
  await server.register(registerAchievementRoutes);
  await server.ready();
  return server;
}

type TestStore = ReturnType<typeof createStore>;

function createStore() {
  const achievement = {
    id: achievementId,
    code: "first_paid_pooping",
    name: "第一次带薪坚持",
    description: "完成第一次打卡，恭喜你开始认真休息。",
    ruleType: AchievementRuleType.first_checkin,
    ruleConfig: { count: 1 },
    rewardConfig: { score: 10, cosmeticCode: "badge_paid_pooper" },
    active: true
  };
  const cosmetic = {
    id: cosmeticId,
    code: "badge_paid_pooper",
    name: "带薪蹲坑先锋",
    description: "勇敢地把休息贯彻到底。",
    cosmeticType: CosmeticType.badge,
    rarity: BeanRarity.epic,
    active: true
  };

  return {
    achievement,
    cosmetic,
    stats: {
      userId,
      totalSessions: 1,
      totalDurationSeconds: 300,
      eligibleDurationSeconds: 300,
      currentStreakDays: 1,
      longestStreakDays: 1,
      lastEligibleCheckinDate: new Date(),
      drawChances: 0,
      drawProgress: 0,
      updatedAt: new Date()
    },
    userAchievements: [] as Array<{
      userId: string;
      achievementId: string;
      unlockedAt: Date;
      rewardClaimedAt: Date | null;
    }>,
    userCosmetics: [] as Array<{
      userId: string;
      cosmeticId: string;
      unlockedAt: Date;
      sourceType: RewardSourceType;
    }>,
    rewardLedger: [] as Array<Record<string, unknown>>,
    leaderboardScores: [] as Array<{
      userId: string;
      window: string;
      windowStart: Date;
      score: number;
    }>,
    profiles: new Map<string, Record<string, unknown>>(),
    auditEvents: [] as Array<Record<string, unknown>>
  };
}

function createPrismaMock(store: TestStore) {
  const prisma: Record<string, unknown> = {
    achievement: {
      findMany: async ({ include }: { include?: unknown } = {}) => {
        if (!include) {
          return [store.achievement];
        }

        return [
          {
            ...store.achievement,
            users: store.userAchievements.filter((item) => item.userId === userId)
          }
        ];
      }
    },
    userAchievement: {
      findMany: async ({ where }: { where: { userId: string } }) =>
        store.userAchievements.filter((item) => item.userId === where.userId),
      create: async ({ data }: { data: TestStore["userAchievements"][number] }) => {
        store.userAchievements.push(data);
        return data;
      }
    },
    userStats: {
      findUnique: async ({ where }: { where: { userId: string } }) =>
        where.userId === userId ? store.stats : null,
      upsert: async () => store.stats
    },
    beanInventory: {
      count: async () => 0
    },
    activityAssignment: {
      count: async () => 0
    },
    leaderboardScore: {
      findUnique: async () => null,
      count: async () => 0,
      upsert: async ({
        create
      }: {
        create: { userId: string; window: string; windowStart: Date; score: number };
      }) => {
        store.leaderboardScores.push(create);
        return create;
      }
    },
    cosmetic: {
      findUnique: async ({ where }: { where: { code?: string; id?: string } }) =>
        where.code === store.cosmetic.code || where.id === store.cosmetic.id ? store.cosmetic : null
    },
    userCosmetic: {
      findMany: async ({ where }: { where: { userId: string } }) =>
        store.userCosmetics
          .filter((item) => item.userId === where.userId)
          .map((item) => ({ ...item, cosmetic: store.cosmetic })),
      findUnique: async ({
        where
      }: {
        where: { userId_cosmeticId: { userId: string; cosmeticId: string } };
      }) => {
        const key = where.userId_cosmeticId;
        const owned = store.userCosmetics.find(
          (item) => item.userId === key.userId && item.cosmeticId === key.cosmeticId
        );
        return owned ? { ...owned, cosmetic: store.cosmetic } : null;
      },
      upsert: async ({
        where,
        create
      }: {
        where: { userId_cosmeticId: { userId: string; cosmeticId: string } };
        create: TestStore["userCosmetics"][number];
      }) => {
        const key = where.userId_cosmeticId;
        const existing = store.userCosmetics.find(
          (item) => item.userId === key.userId && item.cosmeticId === key.cosmeticId
        );
        if (existing) {
          return existing;
        }

        store.userCosmetics.push(create);
        return create;
      }
    },
    userProfile: {
      findUnique: async ({ where }: { where: { userId: string } }) =>
        store.profiles.get(where.userId) ?? null,
      upsert: async ({
        where,
        create,
        update
      }: {
        where: { userId: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const next = { ...(store.profiles.get(where.userId) ?? create), ...update };
        store.profiles.set(where.userId, next);
        return next;
      }
    },
    rewardLedger: {
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
        store.rewardLedger.push(...data);
        return { count: data.length };
      }
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
