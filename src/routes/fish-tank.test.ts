import { beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { registerConfig } from "../plugins/config.js";
import { registerObservability } from "../plugins/observability.js";
import { registerFishTankRoutes } from "./fish-tank.js";
import type { RuntimeConfig } from "../config/runtime.js";

const userId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "22222222-2222-4222-8222-222222222222";
const starterFishId = "33333333-3333-4333-8333-333333333333";

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
  fishTank: { starterFishCode: "starter_goldfish", feedCooldownSeconds: 4 * 60 * 60 }
};

describe("fish tank routes", () => {
  let store: TestStore;

  beforeEach(() => {
    store = createStore();
  });

  it("returns uninitialized summary for a first-time user", async () => {
    const server = await buildTestServer(store);

    const response = await server.inject({
      method: "GET",
      url: "/v1/fish-tank",
      headers: { authorization: "Bearer test" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      initialized: false,
      fish: [],
      careAvailability: {
        feed: { available: true, nextAvailableAt: null, cooldownRemainingSeconds: 0 }
      },
      nextAction: "initialize"
    });

    await server.close();
  });

  it("initializes tank and grants starter fish idempotently", async () => {
    const server = await buildTestServer(store);

    const first = await server.inject({
      method: "POST",
      url: "/v1/fish-tank/initialize",
      headers: { authorization: "Bearer test" }
    });

    expect(first.statusCode).toBe(200);
    expect(first.json().data).toMatchObject({
      initialized: true,
      fish: [
        {
          id: expect.any(String),
          name: "摸鱼初心小金",
          rarity: "common",
          acquiredSource: "starter"
        }
      ],
      nextAction: "feed"
    });

    const second = await server.inject({
      method: "POST",
      url: "/v1/fish-tank/initialize",
      headers: { authorization: "Bearer test" }
    });

    expect(second.statusCode).toBe(200);
    expect(second.json().data.fish).toHaveLength(1);
    expect(store.userFish.size).toBe(1);
    expect(store.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "fish_tank.initialized" }),
        expect.objectContaining({ eventType: "fish_tank.initialize.repeated" })
      ])
    );

    await server.close();
  });

  it("returns real care cooldown state when initialization is repeated", async () => {
    const server = await buildTestServer(store);
    store.userTank.set(userId, { userId });
    store.userFish.set(`${userId}:${starterFishId}`, {
      id: "fish-1",
      userId,
      fishDefinitionId: starterFishId,
      acquiredSource: "starter",
      displayOrder: 0,
      createdAt: new Date()
    });
    store.careEvents.push({
      id: "care-1",
      userId,
      interactionType: "feed",
      idempotencyKey: "first_feed",
      resultMetadata: { resultCopy: "投喂成功，小鱼看起来很满意。" },
      createdAt: new Date()
    });

    const response = await server.inject({
      method: "POST",
      url: "/v1/fish-tank/initialize",
      headers: { authorization: "Bearer test" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.careAvailability.feed.available).toBe(false);
    expect(response.json().data.nextAction).toBe("wait");
    expect(store.userFish.size).toBe(1);

    await server.close();
  });

  it("returns only the authenticated user's fish", async () => {
    const server = await buildTestServer(store);
    store.userTank.set(userId, { userId });
    store.userFish.set(`${userId}:${starterFishId}`, {
      id: "fish-1",
      userId,
      fishDefinitionId: starterFishId,
      acquiredSource: "starter",
      displayOrder: 0,
      createdAt: new Date()
    });
    store.userTank.set(otherUserId, { userId: otherUserId });
    store.userFish.set(`${otherUserId}:${starterFishId}`, {
      id: "fish-other",
      userId: otherUserId,
      fishDefinitionId: starterFishId,
      acquiredSource: "starter",
      displayOrder: 0,
      createdAt: new Date()
    });

    const response = await server.inject({
      method: "GET",
      url: "/v1/fish-tank",
      headers: { authorization: "Bearer test" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.fish).toHaveLength(1);
    expect(response.json().data.fish[0].id).toBe("fish-1");
    expect(response.body).not.toContain("fish-other");
    expect(response.body).not.toContain(otherUserId);

    await server.close();
  });

  it("performs feed care and respects idempotency key", async () => {
    const server = await buildTestServer(store);
    store.userTank.set(userId, { userId });
    store.userFish.set(`${userId}:${starterFishId}`, {
      id: "fish-1",
      userId,
      fishDefinitionId: starterFishId,
      acquiredSource: "starter",
      displayOrder: 0,
      createdAt: new Date()
    });

    const first = await server.inject({
      method: "POST",
      url: "/v1/fish-tank/interactions",
      headers: { authorization: "Bearer test" },
      payload: { interactionType: "feed", idempotencyKey: "feed_key_1" }
    });

    expect(first.statusCode).toBe(200);
    expect(first.json().data).toMatchObject({
      success: true,
      resultCopy: "投喂成功，小鱼看起来很满意。"
    });

    const repeat = await server.inject({
      method: "POST",
      url: "/v1/fish-tank/interactions",
      headers: { authorization: "Bearer test" },
      payload: { interactionType: "feed", idempotencyKey: "feed_key_1" }
    });

    expect(repeat.statusCode).toBe(200);
    expect(repeat.json().data.success).toBe(true);
    expect(store.careEvents).toHaveLength(1);
    expect(store.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "fish_tank.care.completed" })
      ])
    );

    await server.close();
  });

  it("rejects feed when on cooldown without recording duplicate events", async () => {
    const server = await buildTestServer(store);
    store.userTank.set(userId, { userId });
    store.userFish.set(`${userId}:${starterFishId}`, {
      id: "fish-1",
      userId,
      fishDefinitionId: starterFishId,
      acquiredSource: "starter",
      displayOrder: 0,
      createdAt: new Date()
    });
    store.careEvents.push({
      id: "care-1",
      userId,
      interactionType: "feed",
      idempotencyKey: "first_feed",
      resultMetadata: { resultCopy: "投喂成功，小鱼看起来很满意。" },
      createdAt: new Date()
    });

    const response = await server.inject({
      method: "POST",
      url: "/v1/fish-tank/interactions",
      headers: { authorization: "Bearer test" },
      payload: { interactionType: "feed", idempotencyKey: "second_feed" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      success: false,
      resultCopy: "它刚刚吃饱，正在假装工作。"
    });
    expect(store.careEvents).toHaveLength(1);
    expect(store.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "fish_tank.care.unavailable" })
      ])
    );

    await server.close();
  });

  it("rejects unsupported interaction types", async () => {
    const server = await buildTestServer(store);
    store.userTank.set(userId, { userId });

    const response = await server.inject({
      method: "POST",
      url: "/v1/fish-tank/interactions",
      headers: { authorization: "Bearer test" },
      payload: { interactionType: "dance", idempotencyKey: "dance_key_1" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("UNSUPPORTED_INTERACTION");

    await server.close();
  });

  it("rejects care when tank is not initialized", async () => {
    const server = await buildTestServer(store);

    const response = await server.inject({
      method: "POST",
      url: "/v1/fish-tank/interactions",
      headers: { authorization: "Bearer test" },
      payload: { interactionType: "feed", idempotencyKey: "feed_key_1" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("TANK_NOT_INITIALIZED");

    await server.close();
  });

  it("emits safe audit logs with request, trace, user ids and no private profile data", async () => {
    const server = await buildTestServer(store);

    await server.inject({
      method: "POST",
      url: "/v1/fish-tank/initialize",
      headers: { authorization: "Bearer test" }
    });

    expect(store.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "fish_tank.initialized",
          requestId: expect.any(String),
          traceId: expect.stringMatching(/^trc_/),
          actorUserId: userId
        })
      ])
    );
    expect(JSON.stringify(store.auditEvents)).not.toContain("tester@example.com");

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
  await server.register(registerFishTankRoutes);
  await server.ready();
  return server;
}

type TestTank = { userId: string };
type TestFish = {
  id: string;
  userId: string;
  fishDefinitionId: string;
  acquiredSource: string;
  displayOrder: number;
  createdAt: Date;
};
type TestCareEvent = {
  id: string;
  userId: string;
  interactionType: string;
  idempotencyKey: string;
  resultMetadata: Record<string, unknown>;
  createdAt: Date;
};

type TestStore = ReturnType<typeof createStore>;

function createStore() {
  const userTank = new Map<string, TestTank>();
  const userFish = new Map<string, TestFish>();
  const careEvents: TestCareEvent[] = [];
  const auditEvents: Array<Record<string, unknown>> = [];

  const starterDefinition = {
    id: starterFishId,
    code: "starter_goldfish",
    name: "摸鱼初心小金",
    rarity: "common",
    theme: "daydream",
    personality: "假装工作的",
    artKey: "fish-starter-goldfish",
    sourceHint: "starter",
    active: true,
    sortOrder: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  return { userTank, userFish, careEvents, auditEvents, starterDefinition };
}

function createPrismaMock(store: TestStore) {
  const prisma: Record<string, unknown> = {
    userTank: {
      findUnique: async ({ where }: { where: { userId: string } }) =>
        store.userTank.get(where.userId) ?? null,
      create: async ({ data }: { data: { userId: string } }) => {
        store.userTank.set(data.userId, data);
        return data;
      },
      upsert: async ({ where, create, update }: { where: { userId: string }; create: { userId: string }; update: Record<string, never> }) => {
        const existing = store.userTank.get(where.userId);
        if (existing) return { ...existing, ...update };
        store.userTank.set(create.userId, create);
        return create;
      }
    },
    userFish: {
      findMany: async ({ where, include, orderBy }: { where: { userId: string }; include?: { definition: boolean }; orderBy?: { displayOrder: string } }) => {
        const rows = [...store.userFish.values()].filter((f) => f.userId === where.userId);
        if (include?.definition) {
          return rows.map((f) => ({ ...f, definition: store.starterDefinition }));
        }
        return rows;
      },
      create: async ({ data }: { data: Omit<TestFish, "id"> }) => {
        const fish: TestFish = {
          ...data,
          id: "generated-fish-id",
          createdAt: data.createdAt ?? new Date()
        };
        store.userFish.set(`${data.userId}:${data.fishDefinitionId}`, fish);
        return fish;
      },
      upsert: async ({
        where,
        create,
        update
      }: {
        where: { userId_fishDefinitionId: { userId: string; fishDefinitionId: string } };
        create: Omit<TestFish, "id">;
        update: Partial<TestFish>;
      }) => {
        const key = `${where.userId_fishDefinitionId.userId}:${where.userId_fishDefinitionId.fishDefinitionId}`;
        const existing = store.userFish.get(key);
        if (existing) {
          const updated = { ...existing, ...update };
          store.userFish.set(key, updated);
          return updated;
        }
        const fish: TestFish = {
          ...create,
          id: "generated-fish-id",
          createdAt: create.createdAt ?? new Date()
        };
        store.userFish.set(key, fish);
        return fish;
      }
    },
    fishDefinition: {
      findUnique: async ({ where }: { where: { code: string } }) => {
        if (where.code === store.starterDefinition.code) return store.starterDefinition;
        return null;
      }
    },
    fishCareEvent: {
      findFirst: async ({ where, orderBy }: { where: { userId: string; interactionType: string }; orderBy: { createdAt: string } }) => {
        return (
          store.careEvents
            .filter((e) => e.userId === where.userId && e.interactionType === where.interactionType)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
        );
      },
      findUnique: async ({ where }: { where: { userId_idempotencyKey: { userId: string; idempotencyKey: string } } }) => {
        return (
          store.careEvents.find(
            (e) =>
              e.userId === where.userId_idempotencyKey.userId &&
              e.idempotencyKey === where.userId_idempotencyKey.idempotencyKey
          ) ?? null
        );
      },
      create: async ({ data }: { data: Omit<TestCareEvent, "id"> }) => {
        const event: TestCareEvent = {
          ...data,
          id: `care-${store.careEvents.length + 1}`,
          createdAt: data.createdAt ?? new Date()
        };
        store.careEvents.push(event);
        return event;
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
