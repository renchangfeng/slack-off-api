import { AchievementRuleType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { calculateAchievementProgress } from "./progress.js";

const base = {
  totalSessions: 0,
  currentStreakDays: 0,
  eligibleDurationSeconds: 0,
  beanCount: 0,
  completedActivityCount: 0,
  weeklyRank: null
};

describe("achievement progress", () => {
  it("calculates count progress", () => {
    expect(
      calculateAchievementProgress(
        AchievementRuleType.activity_count,
        { count: 5 },
        { ...base, completedActivityCount: 2 }
      )
    ).toEqual({ current: 2, target: 5, unit: "count", percent: 40, completed: false });
  });

  it("calculates duration progress in minutes", () => {
    expect(
      calculateAchievementProgress(
        AchievementRuleType.total_duration,
        { minutes: 30 },
        { ...base, eligibleDurationSeconds: 18 * 60 }
      )
    ).toEqual({ current: 18, target: 30, unit: "minutes", percent: 60, completed: false });
  });

  it("treats a lower rank as better", () => {
    expect(
      calculateAchievementProgress(
        AchievementRuleType.weekly_top_rank,
        { rank: 10 },
        { ...base, weeklyRank: 8 }
      ).completed
    ).toBe(true);
  });
});
