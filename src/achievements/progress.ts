import { AchievementRuleType, type Prisma } from "@prisma/client";

export type AchievementProgressInput = {
  totalSessions: number;
  currentStreakDays: number;
  eligibleDurationSeconds: number;
  beanCount: number;
  completedActivityCount: number;
  weeklyRank: number | null;
};

export type AchievementProgress = {
  current: number;
  target: number;
  unit: "count" | "days" | "minutes" | "rank";
  percent: number;
  completed: boolean;
};

type RuleConfig = {
  count?: number;
  days?: number;
  seconds?: number;
  minutes?: number;
  rank?: number;
};

export function calculateAchievementProgress(
  ruleType: AchievementRuleType,
  ruleConfigValue: Prisma.JsonValue,
  input: AchievementProgressInput
): AchievementProgress {
  const config = toRuleConfig(ruleConfigValue);
  if (ruleType === AchievementRuleType.first_checkin) {
    return progress(input.totalSessions, config.count ?? 1, "count");
  }
  if (ruleType === AchievementRuleType.streak) {
    return progress(input.currentStreakDays, config.days ?? config.count ?? 1, "days");
  }
  if (ruleType === AchievementRuleType.total_duration) {
    const target = config.minutes ?? Math.ceil((config.seconds ?? 0) / 60);
    return progress(Math.floor(input.eligibleDurationSeconds / 60), Math.max(1, target), "minutes");
  }
  if (ruleType === AchievementRuleType.activity_count) {
    return progress(input.completedActivityCount, config.count ?? 1, "count");
  }
  if (ruleType === AchievementRuleType.collection_count) {
    return progress(input.beanCount, config.count ?? 1, "count");
  }
  if (ruleType === AchievementRuleType.weekly_top_rank) {
    const target = config.rank ?? 10;
    const current = input.weeklyRank ?? 0;
    return {
      current,
      target,
      unit: "rank",
      percent: current > 0 ? Math.min(100, Math.round((target / current) * 100)) : 0,
      completed: current > 0 && current <= target
    };
  }
  return progress(0, 1, "count");
}

function progress(
  current: number,
  target: number,
  unit: AchievementProgress["unit"]
): AchievementProgress {
  return {
    current,
    target,
    unit,
    percent: Math.min(100, Math.round((current / Math.max(1, target)) * 100)),
    completed: current >= target
  };
}

function toRuleConfig(value: Prisma.JsonValue): RuleConfig {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}
