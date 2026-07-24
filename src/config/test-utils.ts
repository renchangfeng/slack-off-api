import type { RuntimeConfig } from "./runtime.js";

export function createTestRuntimeConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
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
    fishTank: {
      starterFishCode: "starter_goldfish",
      feedCooldownSeconds: 4 * 60 * 60,
      bubbleCooldownSeconds: 60 * 60,
      feedCost: 1,
      bubbleCost: 1,
      hatchProgressCost: 3,
      existingLoopRewards: {
        policyVersion: "v1",
        sources: {
          checkInFinish: [{ resourceType: "food", quantity: 1 }],
          activityCompletion: [{ resourceType: "bubble", quantity: 1 }],
          dailyGoalClaim: [{ resourceType: "hatch_progress", quantity: 1 }],
          weeklyGoalClaim: [{ resourceType: "hatch_progress", quantity: 2 }]
        }
      }
    },
    ...overrides
  };
}
