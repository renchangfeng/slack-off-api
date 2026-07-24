import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { createTestRuntimeConfig } from "../config/test-utils.js";
import { registerConfig } from "../plugins/config.js";
import { registerObservability } from "../plugins/observability.js";
import { anonymousAlias, canonicalPair, registerSocialRoutes, utcDate } from "./social.js";

const userId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "22222222-2222-4222-8222-222222222222";
const runtimeConfig = createTestRuntimeConfig();

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

  it("returns reaction quota in social summary", async () => {
    const server = await buildServer();
    const response = await server.inject({
      method: "GET",
      url: "/v1/social/summary",
      headers: { authorization: "Bearer test" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.reactions).toMatchObject({
      dailyLimit: 10,
      sentToday: 2,
      remainingToday: 8,
      resetTimezone: "UTC"
    });
    await server.close();
  });

  it("returns user-facing feedback after sending a reaction", async () => {
    const server = await buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/v1/social/reactions",
      headers: { authorization: "Bearer test" },
      payload: { recipientUserId: otherUserId, reactionType: "tissue" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      created: true,
      reactionType: "tissue",
      counts: { tissue: 1, like: 0 },
      remainingToday: 7,
      resultTitle: "纸已递到",
      resultCopy: expect.stringContaining("今天还可以送 7 次")
    });
    await server.close();
  });
});

async function buildServer() {
  const server = Fastify({ logger: false });
  const reactions: Array<{ senderId: string; recipientId: string; reactionType: "tissue" | "like"; reactionDate: Date; id: string }> = [
    {
      id: "reaction-1",
      senderId: userId,
      recipientId: "33333333-3333-4333-8333-333333333333",
      reactionType: "like",
      reactionDate: utcDate(new Date())
    },
    {
      id: "reaction-2",
      senderId: userId,
      recipientId: "44444444-4444-4444-8444-444444444444",
      reactionType: "tissue",
      reactionDate: utcDate(new Date())
    }
  ];
  server.decorate("prisma", {
    user: {
      findUnique: async ({ where }: { where: { id?: string; friendCode?: string } }) => {
        if (where.id === otherUserId) {
          return { id: otherUserId, friendCode: "OTHER123", displayName: "other" };
        }
        return {
          id: userId,
          friendCode: "SELF1234",
          displayName: "tester"
        };
      },
      update: async () => ({
        id: userId,
        friendCode: "SELF1234",
        displayName: "tester",
        friendshipsAsA: [],
        friendshipsAsB: [],
        squadMembership: null,
        companyMembership: null
      })
    },
    friendship: {
      upsert: async () => ({ id: "friendship-1" })
    },
    socialReaction: {
      count: async ({ where }: { where: { senderId: string; reactionDate: Date } }) =>
        reactions.filter(
          (reaction) =>
            reaction.senderId === where.senderId &&
            reaction.reactionDate.getTime() === where.reactionDate.getTime()
        ).length,
      create: async ({ data }: { data: { senderId: string; recipientId: string; reactionType: "tissue" | "like"; reactionDate: Date } }) => {
        const row = { id: `reaction-${reactions.length + 1}`, ...data };
        reactions.push(row);
        return row;
      },
      findUniqueOrThrow: async () => reactions[0],
      groupBy: async ({ where }: { where: { recipientId: string } }) => {
        const recipientRows = reactions.filter((reaction) => reaction.recipientId === where.recipientId);
        return ["tissue", "like"].map((reactionType) => ({
          reactionType,
          _count: {
            _all: recipientRows.filter((reaction) => reaction.reactionType === reactionType).length
          }
        }));
      }
    },
    auditEvent: {
      create: async () => ({})
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
