import { describe, expect, it } from "vitest";
import {
  loadRuntimeConfig,
  validateRuntimeConfig,
  MAX_EXISTING_LOOP_REWARD_QUANTITY,
  type RuntimeConfig
} from "./runtime.js";

describe("runtime config", () => {
  it("loads conservative defaults for existing loop rewards", async () => {
    const config = await loadRuntimeConfig();

    expect(config.fishTank.existingLoopRewards.policyVersion).toBe("v1");
    expect(config.fishTank.existingLoopRewards.sources.checkInFinish).toEqual([
      { resourceType: "food", quantity: 1 }
    ]);
    expect(config.fishTank.existingLoopRewards.sources.activityCompletion).toEqual([
      { resourceType: "bubble", quantity: 1 }
    ]);
    expect(config.fishTank.existingLoopRewards.sources.dailyGoalClaim).toEqual([
      { resourceType: "hatch_progress", quantity: 1 }
    ]);
    expect(config.fishTank.existingLoopRewards.sources.weeklyGoalClaim).toEqual([
      { resourceType: "hatch_progress", quantity: 2 }
    ]);
  });

  it("accepts valid overrides", () => {
    const override = createValidConfig();
    override.fishTank.existingLoopRewards = {
      policyVersion: "v2",
      sources: {
        checkInFinish: [{ resourceType: "bubble", quantity: 2 }],
        activityCompletion: [{ resourceType: "food", quantity: 3 }],
        dailyGoalClaim: [],
        weeklyGoalClaim: [{ resourceType: "hatch_progress", quantity: 5 }]
      }
    };

    const config = validateRuntimeConfig(override);
    expect(config.fishTank.existingLoopRewards.policyVersion).toBe("v2");
    expect(config.fishTank.existingLoopRewards.sources.dailyGoalClaim).toEqual([]);
  });

  it("rejects empty policy version", () => {
    const invalid = createValidConfig();
    invalid.fishTank.existingLoopRewards.policyVersion = "";
    expect(() => validateRuntimeConfig(invalid)).toThrow();
  });

  it("rejects negative quantity", () => {
    const invalid = createValidConfig();
    invalid.fishTank.existingLoopRewards.sources.checkInFinish = [
      { resourceType: "food", quantity: -1 }
    ];
    expect(() => validateRuntimeConfig(invalid)).toThrow();
  });

  it("rejects zero quantity", () => {
    const invalid = createValidConfig();
    invalid.fishTank.existingLoopRewards.sources.activityCompletion = [
      { resourceType: "bubble", quantity: 0 }
    ];
    expect(() => validateRuntimeConfig(invalid)).toThrow();
  });

  it("rejects excessive quantity", () => {
    const invalid = createValidConfig();
    invalid.fishTank.existingLoopRewards.sources.dailyGoalClaim = [
      { resourceType: "hatch_progress", quantity: MAX_EXISTING_LOOP_REWARD_QUANTITY + 1 }
    ];
    expect(() => validateRuntimeConfig(invalid)).toThrow();
  });

  it("rejects unsupported resource type", () => {
    const invalid = createValidConfig();
    (invalid.fishTank.existingLoopRewards.sources.weeklyGoalClaim as unknown) = [
      { resourceType: "gems", quantity: 1 }
    ];
    expect(() => validateRuntimeConfig(invalid)).toThrow();
  });

  it("accepts disabled sources as empty arrays", () => {
    const config = createValidConfig();
    config.fishTank.existingLoopRewards.sources.checkInFinish = [];
    config.fishTank.existingLoopRewards.sources.activityCompletion = [];
    config.fishTank.existingLoopRewards.sources.dailyGoalClaim = [];
    config.fishTank.existingLoopRewards.sources.weeklyGoalClaim = [];
    expect(() => validateRuntimeConfig(config)).not.toThrow();
  });
});

function createValidConfig(): RuntimeConfig {
  return {
    rateLimits: {
      global: { max: 120, timeWindow: "1 minute" },
      otp: { max: 5, timeWindow: "15 minutes" },
      checkIns: { max: 30, timeWindow: "1 minute" },
      activities: { max: 30, timeWindow: "1 minute" },
      beanDraws: { max: 10, timeWindow: "1 minute" },
      leaderboardReads: { max: 120, timeWindow: "1 minute" },
      profileUpdates: { max: 10, timeWindow: "1 minute" },
      fishTank: { max: 30, timeWindow: "1 minute" }
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
    }
  };
}
