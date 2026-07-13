import { beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { registerConfig } from "../plugins/config.js";
import { registerObservability } from "../plugins/observability.js";
import { registerFishTankRoutes } from "./fish-tank.js";
import type { RuntimeConfig } from "../config/runtime.js";

const userId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "22222222-2222-4222-8222-222222222222";
const starterFishId = "33333333-3333-4333-8333-333333333333";
const printerPeaceId = "44444444-4444-4444-8444-444444444444";
const stallSageId = "55555555-5555-4555-8555-555555555555";
const cloudMeetingId = "66666666-6666-4666-8666-666666666666";
const moonlightAnglerId = "77777777-7777-4777-8777-777777777777";

const defaultBgId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const defaultPlantId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const defaultPropId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const defaultAmbientId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const lockedBgId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const lockedPlantId = "ffffffff-ffff-4fff-8fff-ffffffffffff";

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

  it("rejects hatch when tank is not initialized", async () => {
    const server = await buildTestServer(store);

    const response = await server.inject({
      method: "POST",
      url: "/v1/fish-tank/hatch",
      headers: { authorization: "Bearer test" },
      payload: { idempotencyKey: "hatch_key_1" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("TANK_NOT_INITIALIZED");
    expect(store.hatchEvents).toHaveLength(0);
    expect(store.resourceLedger).toHaveLength(0);

    await server.close();
  });

  it("rejects hatch when progress is insufficient without mutation", async () => {
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

    const response = await server.inject({
      method: "POST",
      url: "/v1/fish-tank/hatch",
      headers: { authorization: "Bearer test" },
      payload: { idempotencyKey: "hatch_key_1" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      success: false,
      outcomeCode: "INSUFFICIENT_HATCH_PROGRESS",
      cost: 0
    });
    expect(store.hatchEvents).toHaveLength(0);
    expect(store.resourceLedger).toHaveLength(0);
    expect(store.auditEvents).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventType: "fish_tank.hatch.insufficient_progress" })])
    );

    await server.close();
  });

  it("hatches a new fish and records debit, ownership, and idempotent replay", async () => {
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
    grantHatchProgress(store, userId, 5);

    const first = await server.inject({
      method: "POST",
      url: "/v1/fish-tank/hatch",
      headers: { authorization: "Bearer test" },
      payload: { idempotencyKey: "hatch_key_1" }
    });

    expect(first.statusCode).toBe(200);
    expect(first.json().data).toMatchObject({
      success: true,
      replayed: false,
      cost: 3,
      outcomeCode: "DISCOVERED"
    });
    const discoveredFishId = first.json().data.discoveredFish?.definitionId;
    const discoveredOwnershipId = first.json().data.discoveredFish?.id;
    expect(discoveredFishId).toBeDefined();
    expect(discoveredOwnershipId).toBeDefined();
    expect(store.hatchEvents).toHaveLength(1);
    expect(store.userFish.size).toBe(2);
    expect(getHatchProgressTotal(store, userId)).toBe(2);

    const second = await server.inject({
      method: "POST",
      url: "/v1/fish-tank/hatch",
      headers: { authorization: "Bearer test" },
      payload: { idempotencyKey: "hatch_key_1" }
    });

    expect(second.statusCode).toBe(200);
    expect(second.json().data).toMatchObject({
      success: true,
      replayed: true,
      cost: 3,
      discoveredFish: expect.objectContaining({
        id: discoveredOwnershipId,
        definitionId: discoveredFishId
      })
    });
    expect(store.hatchEvents).toHaveLength(1);
    expect(store.userFish.size).toBe(2);
    expect(getHatchProgressTotal(store, userId)).toBe(2);

    await server.close();
  });

  it("reports catalog complete without spending progress", async () => {
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
    store.userFish.set(`${userId}:${printerPeaceId}`, {
      id: "fish-2",
      userId,
      fishDefinitionId: printerPeaceId,
      acquiredSource: "hatch",
      displayOrder: 1,
      createdAt: new Date()
    });
    store.userFish.set(`${userId}:${stallSageId}`, {
      id: "fish-3",
      userId,
      fishDefinitionId: stallSageId,
      acquiredSource: "hatch",
      displayOrder: 2,
      createdAt: new Date()
    });
    store.userFish.set(`${userId}:${cloudMeetingId}`, {
      id: "fish-4",
      userId,
      fishDefinitionId: cloudMeetingId,
      acquiredSource: "hatch",
      displayOrder: 3,
      createdAt: new Date()
    });
    store.userFish.set(`${userId}:${moonlightAnglerId}`, {
      id: "fish-5",
      userId,
      fishDefinitionId: moonlightAnglerId,
      acquiredSource: "hatch",
      displayOrder: 4,
      createdAt: new Date()
    });
    grantHatchProgress(store, userId, 10);

    const response = await server.inject({
      method: "POST",
      url: "/v1/fish-tank/hatch",
      headers: { authorization: "Bearer test" },
      payload: { idempotencyKey: "hatch_complete_1" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      success: false,
      outcomeCode: "FISH_CATALOG_COMPLETE",
      cost: 0
    });
    expect(getHatchProgressTotal(store, userId)).toBe(10);
    expect(store.hatchEvents).toHaveLength(0);

    await server.close();
  });

  it("selects fish deterministically from user id and idempotency key", async () => {
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
    grantHatchProgress(store, userId, 6);

    const first = await server.inject({
      method: "POST",
      url: "/v1/fish-tank/hatch",
      headers: { authorization: "Bearer test" },
      payload: { idempotencyKey: "stable_key_a" }
    });
    const firstId = first.json().data.discoveredFish?.definitionId;

    // Reset ownership but keep same key; selection should land on the same fish
    store.userFish.clear();
    store.userFish.set(`${userId}:${starterFishId}`, {
      id: "fish-1",
      userId,
      fishDefinitionId: starterFishId,
      acquiredSource: "starter",
      displayOrder: 0,
      createdAt: new Date()
    });
    store.hatchEvents.length = 0;
    store.resourceLedger.length = 0;
    grantHatchProgress(store, userId, 6);

    const second = await server.inject({
      method: "POST",
      url: "/v1/fish-tank/hatch",
      headers: { authorization: "Bearer test" },
      payload: { idempotencyKey: "stable_key_a" }
    });

    expect(second.json().data.discoveredFish?.definitionId).toBe(firstId);

    await server.close();
  });

  it("isolates hatch state between users", async () => {
    const server = await buildTestServer(store);
    store.userTank.set(userId, { userId });
    store.userTank.set(otherUserId, { userId: otherUserId });
    store.userFish.set(`${userId}:${starterFishId}`, {
      id: "fish-1",
      userId,
      fishDefinitionId: starterFishId,
      acquiredSource: "starter",
      displayOrder: 0,
      createdAt: new Date()
    });
    store.userFish.set(`${otherUserId}:${starterFishId}`, {
      id: "fish-other",
      userId: otherUserId,
      fishDefinitionId: starterFishId,
      acquiredSource: "starter",
      displayOrder: 0,
      createdAt: new Date()
    });
    grantHatchProgress(store, userId, 3);
    grantHatchProgress(store, otherUserId, 3);

    const first = await server.inject({
      method: "POST",
      url: "/v1/fish-tank/hatch",
      headers: { authorization: "Bearer test" },
      payload: { idempotencyKey: "shared_key" }
    });

    expect(first.statusCode).toBe(200);
    expect(first.json().data.success).toBe(true);
    expect(getHatchProgressTotal(store, userId)).toBe(0);
    expect(getHatchProgressTotal(store, otherUserId)).toBe(3);

    await server.close();
  });

  it("equips a decoration and returns updated summary", async () => {
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
    store.ownedDecorations.set(`${userId}:${lockedBgId}`, {
      userId,
      decorationDefinitionId: lockedBgId,
      quantity: 1,
      acquiredSource: "achievement",
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const response = await server.inject({
      method: "POST",
      url: "/v1/fish-tank/decorations/equip",
      headers: { authorization: "Bearer test" },
      payload: { slot: "background", decorationDefinitionId: lockedBgId, idempotencyKey: "equip-bg-1" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      success: true,
      replayed: false,
      outcomeCode: "EQUIPPED",
      equipped: expect.objectContaining({ code: "office_window_background", slot: "background" })
    });
    expect(response.json().data.tank.decorations.equipped.find((d: { slot: string }) => d.slot === "background")?.code).toBe("office_window_background");
    expect(store.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "fish_tank.decor.equip.completed",
          metadata: expect.objectContaining({
            userId,
            traceId: expect.any(String),
            replayed: false,
            outcomeCode: "EQUIPPED"
          })
        })
      ])
    );

    await server.close();
  });

  it("replays equip without duplicating mutation or audit", async () => {
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
    store.ownedDecorations.set(`${userId}:${lockedBgId}`, {
      userId,
      decorationDefinitionId: lockedBgId,
      quantity: 1,
      acquiredSource: "achievement",
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const first = await server.inject({
      method: "POST",
      url: "/v1/fish-tank/decorations/equip",
      headers: { authorization: "Bearer test" },
      payload: { slot: "background", decorationDefinitionId: lockedBgId, idempotencyKey: "equip-bg-1" }
    });
    const second = await server.inject({
      method: "POST",
      url: "/v1/fish-tank/decorations/equip",
      headers: { authorization: "Bearer test" },
      payload: { slot: "background", decorationDefinitionId: lockedBgId, idempotencyKey: "equip-bg-1" }
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().data.replayed).toBe(true);
    expect(store.equipEvents).toHaveLength(1);
    expect(store.auditEvents.filter((e) => (e.eventType as string).startsWith("fish_tank.decor.equip.completed"))).toHaveLength(1);
    expect(store.auditEvents).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventType: "fish_tank.decor.equip.replayed" })])
    );

    await server.close();
  });

  it("rejects equip when tank is not initialized", async () => {
    const server = await buildTestServer(store);

    const response = await server.inject({
      method: "POST",
      url: "/v1/fish-tank/decorations/equip",
      headers: { authorization: "Bearer test" },
      payload: { slot: "background", decorationDefinitionId: defaultBgId, idempotencyKey: "equip-uninit" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("TANK_NOT_INITIALIZED");

    await server.close();
  });

  it("rejects equipping a locked decoration", async () => {
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

    const response = await server.inject({
      method: "POST",
      url: "/v1/fish-tank/decorations/equip",
      headers: { authorization: "Bearer test" },
      payload: { slot: "background", decorationDefinitionId: lockedBgId, idempotencyKey: "equip-locked" }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("DECORATION_LOCKED");
    expect(store.auditEvents).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventType: "fish_tank.decor.equip.rejected_locked" })])
    );

    await server.close();
  });

  it("rejects equipping into a wrong slot", async () => {
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
    store.ownedDecorations.set(`${userId}:${lockedPlantId}`, {
      userId,
      decorationDefinitionId: lockedPlantId,
      quantity: 1,
      acquiredSource: "achievement",
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const response = await server.inject({
      method: "POST",
      url: "/v1/fish-tank/decorations/equip",
      headers: { authorization: "Bearer test" },
      payload: { slot: "background", decorationDefinitionId: lockedPlantId, idempotencyKey: "equip-wrong" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("WRONG_DECORATION_SLOT");
    expect(store.auditEvents).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventType: "fish_tank.decor.equip.rejected_wrong_slot" })])
    );

    await server.close();
  });

  it("isolates equipped decoration state between users", async () => {
    const server = await buildTestServer(store);
    store.userTank.set(userId, { userId });
    store.userTank.set(otherUserId, { userId: otherUserId });
    store.userFish.set(`${userId}:${starterFishId}`, {
      id: "fish-1",
      userId,
      fishDefinitionId: starterFishId,
      acquiredSource: "starter",
      displayOrder: 0,
      createdAt: new Date()
    });
    store.userFish.set(`${otherUserId}:${starterFishId}`, {
      id: "fish-other",
      userId: otherUserId,
      fishDefinitionId: starterFishId,
      acquiredSource: "starter",
      displayOrder: 0,
      createdAt: new Date()
    });
    store.ownedDecorations.set(`${userId}:${lockedBgId}`, {
      userId,
      decorationDefinitionId: lockedBgId,
      quantity: 1,
      acquiredSource: "achievement",
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await server.inject({
      method: "POST",
      url: "/v1/fish-tank/decorations/equip",
      headers: { authorization: "Bearer test" },
      payload: { slot: "background", decorationDefinitionId: lockedBgId, idempotencyKey: "equip-isolation" }
    });

    expect(store.equippedDecorations.size).toBe(1);
    expect(store.equippedDecorations.has(`${userId}:background`)).toBe(true);
    expect(store.equippedDecorations.has(`${otherUserId}:background`)).toBe(false);

    await server.close();
  });
});

function grantHatchProgress(store: TestStore, targetUserId: string, amount: number) {
  store.resourceLedger.push({
    userId: targetUserId,
    resourceType: "hatch_progress",
    quantity: amount,
    sourceType: "bean_draw",
    sourceId: null,
    idempotencyKey: `grant_${targetUserId}_${store.resourceLedger.length}`,
    metadata: {},
    createdAt: new Date()
  });
}

function getHatchProgressTotal(store: TestStore, targetUserId: string): number {
  return store.resourceLedger
    .filter((entry) => entry.userId === targetUserId && entry.resourceType === "hatch_progress")
    .reduce((sum, entry) => sum + entry.quantity, 0);
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

type TestFishDefinition = {
  id: string;
  code: string;
  name: string;
  rarity: string;
  theme: string;
  personality: string;
  artKey: string;
  sourceHint: string;
  active: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

type TestHatchEvent = {
  id: string;
  userId: string;
  fishDefinitionId: string;
  idempotencyKey: string;
  hatchCost: number;
  outcomeCode: string;
  duplicate: boolean;
  resultMetadata: Record<string, unknown>;
  createdAt: Date;
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

type TestDecorationDefinition = {
  id: string;
  code: string;
  name: string;
  type: string;
  rarity: string;
  theme: string | null;
  artKey: string;
  unlockHint: string;
  active: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

type TestOwnedDecoration = {
  userId: string;
  decorationDefinitionId: string;
  quantity: number;
  acquiredSource: string;
  createdAt: Date;
  updatedAt: Date;
};

type TestEquippedDecoration = {
  userId: string;
  slot: string;
  decorationDefinitionId: string;
  equippedAt: Date;
};

type TestEquipEvent = {
  id: string;
  userId: string;
  slot: string;
  decorationDefinitionId: string;
  idempotencyKey: string;
  outcomeCode: string;
  replay: boolean;
  resultMetadata: Record<string, unknown>;
  createdAt: Date;
};

type TestStore = ReturnType<typeof createStore>;

function createStore() {
  const userTank = new Map<string, TestTank>();
  const userFish = new Map<string, TestFish>();
  const careEvents: TestCareEvent[] = [];
  const hatchEvents: TestHatchEvent[] = [];
  const resourceLedger: TestResourceLedger[] = [];
  const auditEvents: Array<Record<string, unknown>> = [];
  const ownedDecorations = new Map<string, TestOwnedDecoration>();
  const equippedDecorations = new Map<string, TestEquippedDecoration>();
  const equipEvents: TestEquipEvent[] = [];

  const definitions = new Map<string, TestFishDefinition>([
    [
      "starter_goldfish",
      {
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
      }
    ],
    [
      "printer_peace_beta",
      {
        id: printerPeaceId,
        code: "printer_peace_beta",
        name: "打印机和平贝塔",
        rarity: "common",
        theme: "office",
        personality: "宽容卡纸的",
        artKey: "fish-printer-peace-beta",
        sourceHint: "hatch",
        active: true,
        sortOrder: 2,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ],
    [
      "stall_sage_koi",
      {
        id: stallSageId,
        code: "stall_sage_koi",
        name: "隔间贤者鲤",
        rarity: "uncommon",
        theme: "restroom",
        personality: "在安静隔间顿悟的",
        artKey: "fish-stall-sage-koi",
        sourceHint: "hatch",
        active: true,
        sortOrder: 3,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ],
    [
      "cloud_meeting_guppy",
      {
        id: cloudMeetingId,
        code: "cloud_meeting_guppy",
        name: "云端会议鳉",
        rarity: "rare",
        theme: "daydream",
        personality: "会议链接永远找不到的",
        artKey: "fish-cloud-meeting-guppy",
        sourceHint: "hatch",
        active: true,
        sortOrder: 4,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ],
    [
      "moonlight_overtime_angler",
      {
        id: moonlightAnglerId,
        code: "moonlight_overtime_angler",
        name: "月光拒绝加班鮟鱇",
        rarity: "epic",
        theme: "daydream",
        personality: "到点自动熄灯的",
        artKey: "fish-moonlight-overtime-angler",
        sourceHint: "hatch",
        active: true,
        sortOrder: 5,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]
  ]);

  const decorDefinitions = new Map<string, TestDecorationDefinition>([
    [
      "default_tank_background",
      {
        id: defaultBgId,
        code: "default_tank_background",
        name: "基础水缸",
        type: "background",
        rarity: "common",
        theme: "default",
        artKey: "tank-bg-default",
        unlockHint: "初始鱼缸背景",
        active: true,
        sortOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ],
    [
      "default_tank_plant",
      {
        id: defaultPlantId,
        code: "default_tank_plant",
        name: "基础水草",
        type: "plant",
        rarity: "common",
        theme: "default",
        artKey: "tank-plant-default",
        unlockHint: "初始鱼缸植物",
        active: true,
        sortOrder: 2,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ],
    [
      "default_tank_prop_empty",
      {
        id: defaultPropId,
        code: "default_tank_prop_empty",
        name: "空石头",
        type: "prop",
        rarity: "common",
        theme: "default",
        artKey: "tank-prop-empty",
        unlockHint: "初始鱼缸小景",
        active: true,
        sortOrder: 3,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ],
    [
      "default_tank_ambient_bubbles",
      {
        id: defaultAmbientId,
        code: "default_tank_ambient_bubbles",
        name: "基础泡泡",
        type: "ambient",
        rarity: "common",
        theme: "default",
        artKey: "tank-ambient-bubbles",
        unlockHint: "初始水底气泡",
        active: true,
        sortOrder: 4,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ],
    [
      "office_window_background",
      {
        id: lockedBgId,
        code: "office_window_background",
        name: "工位窗景",
        type: "background",
        rarity: "rare",
        theme: "office",
        artKey: "tank-bg-office-window",
        unlockHint: "收集 5 种不同的工位命运豆",
        active: true,
        sortOrder: 11,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ],
    [
      "kelp_forest_plant",
      {
        id: lockedPlantId,
        code: "kelp_forest_plant",
        name: "海藻丛",
        type: "plant",
        rarity: "uncommon",
        theme: "default",
        artKey: "tank-plant-kelp-forest",
        unlockHint: "完成 3 次喂鱼",
        active: true,
        sortOrder: 21,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]
  ]);

  return {
    userTank,
    userFish,
    careEvents,
    hatchEvents,
    resourceLedger,
    auditEvents,
    ownedDecorations,
    equippedDecorations,
    equipEvents,
    starterDefinition: definitions.get("starter_goldfish")!,
    definitions,
    decorDefinitions
  };
}

function createPrismaMock(store: TestStore) {
  function resolveDefinition(by: { id?: string; code?: string }): TestFishDefinition | null {
    if (by.id) {
      for (const def of store.definitions.values()) {
        if (def.id === by.id) return def;
      }
      return null;
    }
    if (by.code) {
      return store.definitions.get(by.code) ?? null;
    }
    return null;
  }

  function resolveDecorDefinition(by: { id?: string; code?: string }): TestDecorationDefinition | null {
    if (by.id) {
      for (const def of store.decorDefinitions.values()) {
        if (def.id === by.id) return def;
      }
      return null;
    }
    if (by.code) {
      return store.decorDefinitions.get(by.code) ?? null;
    }
    return null;
  }

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
      findMany: async ({ where, include }: { where: { userId: string }; include?: { definition: boolean } }) => {
        const rows = [...store.userFish.values()].filter((f) => f.userId === where.userId);
        if (include?.definition) {
          return rows.map((f) => ({ ...f, definition: resolveDefinition({ id: f.fishDefinitionId }) ?? store.starterDefinition }));
        }
        return rows;
      },
      findUnique: async ({ where, include }: { where: { userId_fishDefinitionId: { userId: string; fishDefinitionId: string } }; include?: { definition: boolean } }) => {
        const key = `${where.userId_fishDefinitionId.userId}:${where.userId_fishDefinitionId.fishDefinitionId}`;
        const fish = store.userFish.get(key) ?? null;
        if (fish && include?.definition) {
          return { ...fish, definition: resolveDefinition({ id: fish.fishDefinitionId }) ?? store.starterDefinition };
        }
        return fish;
      },
      create: async ({ data, include }: { data: Omit<TestFish, "id">; include?: { definition: boolean } }) => {
        const fish: TestFish = {
          ...data,
          id: `fish-${store.userFish.size + 1}`,
          createdAt: data.createdAt ?? new Date()
        };
        store.userFish.set(`${data.userId}:${data.fishDefinitionId}`, fish);
        if (include?.definition) {
          return { ...fish, definition: resolveDefinition({ id: data.fishDefinitionId }) ?? store.starterDefinition };
        }
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
          id: `fish-${store.userFish.size + 1}`,
          createdAt: create.createdAt ?? new Date()
        };
        store.userFish.set(key, fish);
        return fish;
      }
    },
    fishDefinition: {
      findUnique: async ({ where }: { where: { id?: string; code?: string } }) => resolveDefinition(where),
      findMany: async ({ where, orderBy }: { where?: { active?: boolean }; orderBy?: { sortOrder: string } }) => {
        let defs = [...store.definitions.values()];
        if (where?.active !== undefined) {
          defs = defs.filter((d) => d.active === where.active);
        }
        if (orderBy?.sortOrder === "asc") {
          defs.sort((a, b) => a.sortOrder - b.sortOrder);
        }
        return defs;
      }
    },
    fishCareEvent: {
      findFirst: async ({ where }: { where: { userId: string; interactionType: string }; orderBy: { createdAt: string } }) => {
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
    fishHatchEvent: {
      findUnique: async ({ where }: { where: { userId_idempotencyKey: { userId: string; idempotencyKey: string } } }) => {
        return (
          store.hatchEvents.find(
            (e) =>
              e.userId === where.userId_idempotencyKey.userId &&
              e.idempotencyKey === where.userId_idempotencyKey.idempotencyKey
          ) ?? null
        );
      },
      findFirst: async ({ where, orderBy }: { where: { userId: string }; orderBy?: { createdAt: string } }) => {
        const rows = store.hatchEvents.filter((e) => e.userId === where.userId);
        rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return rows[0] ?? null;
      },
      create: async ({ data }: { data: Omit<TestHatchEvent, "id"> }) => {
        const event: TestHatchEvent = {
          ...data,
          id: `hatch-${store.hatchEvents.length + 1}`,
          createdAt: data.createdAt ?? new Date()
        };
        store.hatchEvents.push(event);
        return event;
      }
    },
    tankDecorationDefinition: {
      findUnique: async ({ where }: { where: { id?: string; code?: string } }) => resolveDecorDefinition(where),
      findMany: async ({ where }: { where?: { active?: boolean } }) => {
        let defs = [...store.decorDefinitions.values()];
        if (where?.active !== undefined) defs = defs.filter((d) => d.active === where.active);
        defs.sort((a, b) => {
          if (a.type !== b.type) return a.type.localeCompare(b.type);
          return a.sortOrder - b.sortOrder;
        });
        return defs;
      }
    },
    userTankDecoration: {
      findMany: async ({ where }: { where: { userId: string } }) =>
        [...store.ownedDecorations.values()].filter((d) => d.userId === where.userId),
      findUnique: async ({ where }: { where: { userId_decorationDefinitionId: { userId: string; decorationDefinitionId: string } } }) => {
        const key = `${where.userId_decorationDefinitionId.userId}:${where.userId_decorationDefinitionId.decorationDefinitionId}`;
        return store.ownedDecorations.get(key) ?? null;
      },
      upsert: async ({ where, create }: { where: { userId_decorationDefinitionId: { userId: string; decorationDefinitionId: string } }; create: Omit<TestOwnedDecoration, "createdAt" | "updatedAt"> }) => {
        const key = `${where.userId_decorationDefinitionId.userId}:${where.userId_decorationDefinitionId.decorationDefinitionId}`;
        const existing = store.ownedDecorations.get(key);
        if (existing) return existing;
        const created = { ...create, createdAt: new Date(), updatedAt: new Date() };
        store.ownedDecorations.set(key, created);
        return created;
      }
    },
    userTankEquippedDecoration: {
      findMany: async ({ where }: { where: { userId: string } }) =>
        [...store.equippedDecorations.values()].filter((d) => d.userId === where.userId),
      findUnique: async ({ where }: { where: { userId_slot: { userId: string; slot: string } } }) => {
        const key = `${where.userId_slot.userId}:${where.userId_slot.slot}`;
        return store.equippedDecorations.get(key) ?? null;
      },
      upsert: async ({ where, create, update }: { where: { userId_slot: { userId: string; slot: string } }; create: Omit<TestEquippedDecoration, "equippedAt">; update: Partial<TestEquippedDecoration> }) => {
        const key = `${where.userId_slot.userId}:${where.userId_slot.slot}`;
        const existing = store.equippedDecorations.get(key);
        if (existing) {
          const updated = { ...existing, ...update };
          store.equippedDecorations.set(key, updated);
          return updated;
        }
        const created = { ...create, equippedAt: new Date() };
        store.equippedDecorations.set(key, created);
        return created;
      }
    },
    tankDecorationEquipEvent: {
      findUnique: async ({ where }: { where: { userId_idempotencyKey: { userId: string; idempotencyKey: string } } }) => {
        return (
          store.equipEvents.find(
            (e) =>
              e.userId === where.userId_idempotencyKey.userId &&
              e.idempotencyKey === where.userId_idempotencyKey.idempotencyKey
          ) ?? null
        );
      },
      create: async ({ data }: { data: Omit<TestEquipEvent, "id"> }) => {
        const event: TestEquipEvent = {
          ...data,
          id: `equip-${store.equipEvents.length + 1}`,
          createdAt: data.createdAt ?? new Date()
        };
        store.equipEvents.push(event);
        return event;
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
      },
      aggregate: async ({
        where
      }: {
        where: { userId: string; resourceType: string };
        _sum: { quantity: boolean };
      }) => {
        let total = 0;
        for (const entry of store.resourceLedger) {
          if (entry.userId === where.userId && entry.resourceType === where.resourceType) {
            total += entry.quantity;
          }
        }
        return { _sum: { quantity: total } };
      }
    },
    auditEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        store.auditEvents.push(data);
        return data;
      }
    },
    $queryRaw: async () => [{ userId }],
    $transaction: async <T>(fn: (tx: Record<string, unknown>) => Promise<T>) => fn(prisma)
  };

  return prisma;
}
