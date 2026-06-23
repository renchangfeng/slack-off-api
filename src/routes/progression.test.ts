import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { RuntimeConfig } from "../config/runtime.js";
import { registerConfig } from "../plugins/config.js";
import { registerObservability } from "../plugins/observability.js";
import { registerProgressionRoutes } from "./progression.js";

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
    maxSessionSeconds: 60 * 45,
    dailyRewardedSessionCap: 5,
    scorePerEligibleMinute: 1,
    drawProgressPerSession: 1
  },
  beans: { drawProgressPerChance: 3 }
};

describe("progression routes", () => {
  it("returns level, lifetime stats, and daily goals for the authenticated user", async () => {
    const server = await buildTestServer();
    const response = await server.inject({
      method: "GET",
      url: "/v1/progression/summary",
      headers: { authorization: "Bearer test" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      level: 3,
      experience: 245,
      currentLevelExperience: 45,
      nextLevelExperience: 100,
      progressPercent: 45,
      currentStreakDays: 3,
      longestStreakDays: 5,
      lifetime: {
        totalSessions: 8,
        eligibleRestMinutes: 42,
        completedActivities: 6,
        collectedBeanTypes: 2,
        unlockedAchievements: 3
      },
      dailyGoals: {
        completed: 2,
        total: 3,
        goals: [
          expect.objectContaining({ code: "check_in", completed: true }),
          expect.objectContaining({ code: "activity", completed: true }),
          expect.objectContaining({ code: "bean_draw", completed: false })
        ]
      }
    });

    await server.close();
  });
});

async function buildTestServer() {
  const server = Fastify({ logger: false });
  server.decorate("prisma", createPrismaMock() as never);
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

function createPrismaMock() {
  let activityCountCall = 0;
  return {
    userStats: {
      findUnique: async () => ({
        totalSessions: 8,
        eligibleDurationSeconds: 42 * 60,
        currentStreakDays: 3,
        longestStreakDays: 5
      })
    },
    leaderboardScore: {
      findUnique: async () => ({ score: 245 })
    },
    activityAssignment: {
      count: async () => {
        activityCountCall += 1;
        return activityCountCall === 1 ? 6 : 1;
      }
    },
    beanInventory: {
      count: async () => 2
    },
    userAchievement: {
      count: async () => 3
    },
    checkInSession: {
      count: async () => 1
    },
    rewardLedger: {
      count: async () => 0
    }
  };
}
