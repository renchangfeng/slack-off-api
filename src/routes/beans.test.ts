import { BeanRarity, BeanTheme, RewardSourceType, RewardType } from "@prisma/client";
import Fastify from "fastify";
import { beforeEach, describe, expect, it } from "vitest";
import type { RuntimeConfig } from "../config/runtime.js";
import { registerConfig } from "../plugins/config.js";
import { registerObservability } from "../plugins/observability.js";
import { registerBeanRoutes } from "./beans.js";

const userId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "22222222-2222-4222-8222-222222222222";
const beanId = "33333333-3333-4333-8333-333333333333";

const runtimeConfig: RuntimeConfig = {
  rateLimits: {
    global: { max: 1000, timeWindow: "1 minute" },
    otp: { max: 1000, timeWindow: "1 minute" },
    checkIns: { max: 1000, timeWindow: "1 minute" },
    activities: { max: 1000, timeWindow: "1 minute" },
    beanDraws: { max: 1000, timeWindow: "1 minute" },
    leaderboardReads: { max: 1000, timeWindow: "1 minute" },
    profileUpdates: { max: 1000, timeWindow: "1 minute" },
    fishTank: { max: 1000, timeWindow: "1 minute" }
  },
  auth: { requireEmailVerified: false },
  checkIns: {
    minRewardDurationSeconds: 60,
    maxSessionSeconds: 60 * 45,
    dailyRewardedSessionCap: 5,
    scorePerEligibleMinute: 1,
    drawProgressPerSession: 1
  },
  beans: { drawProgressPerChance: 3 },
  fishTank: { starterFishCode: "starter_goldfish", feedCooldownSeconds: 4 * 60 * 60, hatchProgressCost: 3 }
};

describe("bean routes", () => {
  let store: TestStore;

  beforeEach(() => {
    store = createStore();
  });

  it("draws a bean, consumes one chance, updates inventory, and writes audit records", async () => {
    const server = await buildTestServer(store);
    store.stats.set(userId, { userId, drawChances: 1, drawProgress: 0 });

    const response = await server.inject({
      method: "POST",
      url: "/v1/beans/draw",
      headers: { authorization: "Bearer test" },
      payload: { idempotencyKey: "draw_success_1" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      duplicate: false,
      remainingDrawChances: 0,
      resultTitle: "新豆入仓",
      resultCopy: expect.stringContaining("第一次加入豆仓"),
      nextHint: expect.stringContaining("机会用完了"),
      bean: {
        id: beanId,
        rarity: BeanRarity.common,
        theme: BeanTheme.restroom,
        quantity: 1,
        owned: true
      }
    });
    expect(store.stats.get(userId)?.drawChances).toBe(0);
    expect(store.inventory.get(`${userId}:${beanId}`)?.quantity).toBe(1);
    expect(response.json().data.fishTankOutcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resourceType: "bubble", quantity: 1 }),
        expect.objectContaining({ resourceType: "hatch_progress", quantity: 1 })
      ])
    );
    expect(store.resourceLedger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId,
          resourceType: "bubble",
          quantity: 1,
          idempotencyKey: "draw_success_1:bubble"
        }),
        expect.objectContaining({
          userId,
          resourceType: "hatch_progress",
          quantity: 1,
          idempotencyKey: "draw_success_1:hatch_progress"
        })
      ])
    );
    expect(store.rewardLedger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: RewardSourceType.bean_draw,
          rewardType: RewardType.bean
        })
      ])
    );
    expect(store.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "bean.draw.completed",
          traceId: expect.stringMatching(/^trc_/)
        })
      ])
    );

    await server.close();
  });

  it("rejects a draw when no draw chance exists and emits a safe audit event", async () => {
    const server = await buildTestServer(store);
    store.stats.set(userId, { userId, drawChances: 0, drawProgress: 2 });

    const response = await server.inject({
      method: "POST",
      url: "/v1/beans/draw",
      headers: { authorization: "Bearer test" },
      payload: {}
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("NO_DRAW_CHANCE");
    expect(store.rewardLedger).toHaveLength(0);
    expect(store.resourceLedger).toHaveLength(0);
    expect(store.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "bean.draw.rejected",
          metadata: { reason: "NO_DRAW_CHANCE" }
        })
      ])
    );
    expect(JSON.stringify(store.auditEvents)).not.toContain("Authorization");

    await server.close();
  });

  it("returns only the authenticated user's private bean inventory", async () => {
    const server = await buildTestServer(store);
    store.stats.set(userId, { userId, drawChances: 1, drawProgress: 0 });
    store.stats.set(otherUserId, { userId: otherUserId, drawChances: 9, drawProgress: 0 });
    store.inventory.set(`${otherUserId}:${beanId}`, {
      userId: otherUserId,
      beanId,
      quantity: 99,
      firstObtainedAt: new Date(),
      lastObtainedAt: new Date()
    });

    const response = await server.inject({
      method: "GET",
      url: "/v1/beans/collection",
      headers: { authorization: "Bearer test" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      drawChances: 1,
      summary: {
        collected: 0,
        total: 1,
        percent: 0,
        nextAction: expect.any(String)
      },
      nextTarget: {
        id: beanId,
        name: "马桶计时豆",
        rarity: BeanRarity.common,
        theme: BeanTheme.restroom,
        hint: expect.stringContaining("马桶计时豆")
      },
      beans: [
        {
          id: beanId,
          quantity: 0,
          owned: false
        }
      ]
    });
    expect(response.body).not.toContain("99");
    expect(response.body).not.toContain(otherUserId);

    await server.close();
  });

  it("exchanges ten fragments for one draw chance", async () => {
    const server = await buildTestServer(store);
    store.stats.set(userId, {
      userId,
      drawChances: 0,
      drawProgress: 0,
      beanFragments: 12,
      beanPityCount: 0
    });

    const response = await server.inject({
      method: "POST",
      url: "/v1/beans/fragments/exchange",
      headers: { authorization: "Bearer test" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ fragments: 2, drawChances: 1 });

    await server.close();
  });

  it("places an owned bean into the selected showcase slot", async () => {
    const server = await buildTestServer(store);
    store.inventory.set(`${userId}:${beanId}`, {
      userId,
      beanId,
      quantity: 1,
      firstObtainedAt: new Date(),
      lastObtainedAt: new Date()
    });

    const beforeCollection = await server.inject({
      method: "GET",
      url: "/v1/beans/collection",
      headers: { authorization: "Bearer test" }
    });
    const beforeCombinations = beforeCollection.json().data.combinations;
    const beforeResources = [...store.resourceLedger];

    const response = await server.inject({
      method: "PUT",
      url: "/v1/beans/showcase/2",
      headers: { authorization: "Bearer test" },
      payload: { beanId }
    });

    expect(response.statusCode).toBe(200);
    expect(store.showcase.get(`${userId}:2`)).toMatchObject({ beanId, position: 2 });
    const afterCollection = await server.inject({
      method: "GET",
      url: "/v1/beans/collection",
      headers: { authorization: "Bearer test" }
    });
    expect(afterCollection.json().data.combinations).toEqual(beforeCombinations);
    expect(store.resourceLedger).toEqual(beforeResources);

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
  await server.register(registerBeanRoutes);
  await server.ready();
  return server;
}

type TestStats = {
  userId: string;
  drawChances: number;
  drawProgress: number;
  beanFragments?: number;
  beanPityCount?: number;
};

type TestInventory = {
  userId: string;
  beanId: string;
  quantity: number;
  firstObtainedAt: Date;
  lastObtainedAt: Date;
};

type TestResourceLedger = {
  userId: string;
  resourceType: string;
  quantity: number;
  sourceType: string;
  sourceId: string | null;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
};

type TestStore = ReturnType<typeof createStore>;

function createStore() {
  const stats = new Map<string, TestStats>();
  const inventory = new Map<string, TestInventory>();
  const rewardLedger: Array<Record<string, unknown>> = [];
  const resourceLedger: TestResourceLedger[] = [];
  const auditEvents: Array<Record<string, unknown>> = [];
  const showcase = new Map<string, { userId: string; beanId: string; position: number }>();
  const bean = {
    id: beanId,
    code: "toilet_timer_bean",
    name: "马桶计时豆",
    rarity: BeanRarity.common,
    theme: BeanTheme.restroom,
    description: "它不懂 KPI，但它懂你坐了多久。",
    imageKey: null,
    active: true,
    weight: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  return {
    stats,
    inventory,
    rewardLedger,
    resourceLedger,
    auditEvents,
    showcase,
    bean
  };
}

function createPrismaMock(store: TestStore) {
  const prisma: Record<string, unknown> = {
    userStats: {
      findUnique: async ({ where }: { where: { userId: string } }) =>
        store.stats.get(where.userId) ?? null,
      update: async ({
        where,
        data
      }: {
        where: { userId: string };
        data: {
          drawChances?: { decrement: number };
          beanFragments?: { increment: number };
          beanPityCount?: number;
        };
      }) => {
        const current = store.stats.get(where.userId);
        if (!current) {
          throw new Error("Stats not found");
        }
        current.drawChances -= data.drawChances?.decrement ?? 0;
        return current;
      },
      updateMany: async ({ where }: { where: { userId: string; beanFragments: { gte: number } } }) => {
        const current = store.stats.get(where.userId);
        if (!current || (current.beanFragments ?? 0) < where.beanFragments.gte) {
          return { count: 0 };
        }
        current.beanFragments = (current.beanFragments ?? 0) - 10;
        current.drawChances += 1;
        return { count: 1 };
      }
    },
    beanShowcase: {
      findMany: async () => [],
      deleteMany: async ({ where }: { where: { userId: string; beanId: string } }) => {
        for (const [key, item] of store.showcase) {
          if (item.userId === where.userId && item.beanId === where.beanId) {
            store.showcase.delete(key);
          }
        }
        return { count: 1 };
      },
      upsert: async ({
        create,
        update
      }: {
        create: { userId: string; beanId: string; position: number };
        update: { beanId: string };
      }) => {
        const key = `${create.userId}:${create.position}`;
        const value = { ...create, beanId: update.beanId };
        store.showcase.set(key, value);
        return value;
      }
    },
    beanDefinition: {
      findMany: async ({ include }: { include?: unknown }) => {
        if (include) {
          return [
            {
              ...store.bean,
              inventory: [
                ...store.inventory.values()
              ].filter((item) => item.userId === userId && item.beanId === store.bean.id)
            }
          ];
        }

        return [store.bean];
      }
    },
    beanInventory: {
      count: async ({ where }: { where: { userId: string; quantity: { gt: number } } }) =>
        [...store.inventory.values()].filter(
          (item) => item.userId === where.userId && item.quantity > where.quantity.gt
        ).length,
      findUnique: async ({
        where
      }: {
        where: { userId_beanId: { userId: string; beanId: string } };
      }) =>
        store.inventory.get(
          `${where.userId_beanId.userId}:${where.userId_beanId.beanId}`
        ) ?? null,
      upsert: async ({
        where,
        create,
        update
      }: {
        where: { userId_beanId: { userId: string; beanId: string } };
        create: TestInventory;
        update: { quantity: { increment: number }; lastObtainedAt: Date };
      }) => {
        const key = `${where.userId_beanId.userId}:${where.userId_beanId.beanId}`;
        const current = store.inventory.get(key);
        if (!current) {
          store.inventory.set(key, create);
          return create;
        }

        current.quantity += update.quantity.increment;
        current.lastObtainedAt = update.lastObtainedAt;
        return current;
      }
    },
    achievement: {
      findMany: async () => []
    },
    userAchievement: {
      findMany: async () => []
    },
    activityAssignment: {
      count: async () => 0
    },
    leaderboardScore: {
      findUnique: async () => null,
      count: async () => 0,
      upsert: async () => null
    },
    rewardLedger: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        store.rewardLedger.push(data);
        return data;
      }
    },
    fishTankResourceLedger: {
      upsert: async ({
        where,
        create
      }: {
        where: { userId_idempotencyKey: { userId: string; idempotencyKey: string } };
        create: TestResourceLedger;
      }) => {
        const existing = store.resourceLedger.find(
          (entry) =>
            entry.userId === where.userId_idempotencyKey.userId &&
            entry.idempotencyKey === where.userId_idempotencyKey.idempotencyKey
        );
        if (existing) {
          return existing;
        }
        const entry = { ...create, createdAt: create.createdAt ?? new Date() };
        store.resourceLedger.push(entry);
        return entry;
      },
      groupBy: async ({
        where
      }: {
        by: string[];
        where: { userId: string };
        _sum: { quantity: boolean };
      }) => {
        const groups = new Map<string, number>();
        for (const entry of store.resourceLedger) {
          if (entry.userId === where.userId) {
            groups.set(entry.resourceType, (groups.get(entry.resourceType) ?? 0) + entry.quantity);
          }
        }
        return Array.from(groups.entries()).map(([resourceType, quantity]) => ({
          resourceType,
          _sum: { quantity }
        }));
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
