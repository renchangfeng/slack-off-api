import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { RuntimeConfig } from "../config/runtime.js";
import { registerConfig } from "../plugins/config.js";
import { registerObservability } from "../plugins/observability.js";
import { anonymousAlias, canonicalPair, registerSocialRoutes, utcDate } from "./social.js";

const userId = "11111111-1111-4111-8111-111111111111";
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
    maxSessionSeconds: 2700,
    dailyRewardedSessionCap: 5,
    scorePerEligibleMinute: 1,
    drawProgressPerSession: 1
  },
  beans: { drawProgressPerChance: 3 }
};

describe("social helpers", () => {
  it("stores friendships in canonical order", () => {
    expect(canonicalPair("bbbb", "aaaa")).toEqual(["aaaa", "bbbb"]);
    expect(canonicalPair("aaaa", "bbbb")).toEqual(["aaaa", "bbbb"]);
  });

  it("creates stable padded anonymous aliases", () => {
    expect(anonymousAlias(1)).toBe("工位同学 01");
    expect(anonymousAlias(12)).toBe("工位同学 12");
  });

  it("normalizes reaction quotas to a UTC date", () => {
    expect(utcDate(new Date("2026-06-23T23:59:00+08:00")).toISOString()).toBe(
      "2026-06-23T00:00:00.000Z"
    );
  });

  it("rejects adding the authenticated user as a friend", async () => {
    const server = await buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/v1/social/friends",
      headers: { authorization: "Bearer test" },
      payload: { friendCode: "SELF1234" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("SELF_FRIENDSHIP");
    await server.close();
  });

  it("rejects self reactions before writing data", async () => {
    const server = await buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/v1/social/reactions",
      headers: { authorization: "Bearer test" },
      payload: { recipientUserId: userId, reactionType: "tissue" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("SELF_REACTION");
    await server.close();
  });
});

async function buildServer() {
  const server = Fastify({ logger: false });
  server.decorate("prisma", {
    user: {
      findUnique: async () => ({
        id: userId,
        friendCode: "SELF1234",
        displayName: "tester"
      })
    }
  } as never);
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
  await server.register(registerSocialRoutes);
  await server.ready();
  return server;
}
