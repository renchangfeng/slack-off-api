import { AchievementRuleType, type Prisma } from "@prisma/client";
import type { AchievementProgress } from "./progress.js";

export const achievementCategories = [
  "new_user",
  "check_in",
  "activity",
  "bean_draw",
  "leaderboard",
  "social"
] as const;

export const achievementRecommendationGroups = [
  "nearest",
  "today",
  "long_term"
] as const;

export type AchievementCategory = (typeof achievementCategories)[number];
export type AchievementRecommendationGroup = (typeof achievementRecommendationGroups)[number];

export type AchievementActionHint = {
  section: "home" | "activities" | "beans" | "leaderboards" | "profile";
  label: string;
};

export type AchievementMetadata = {
  category: AchievementCategory;
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary";
  weight: number;
  todayFriendly: boolean;
  unlockSummary: string;
  actionHint: AchievementActionHint;
};

export type SerializedAchievementForRecommendation = {
  id: string;
  code: string;
  progress: AchievementProgress;
  unlockedAt: string | null;
  category: AchievementCategory;
  rarity: AchievementMetadata["rarity"];
  recommendationWeight: number;
  todayFriendly: boolean;
  actionHint: AchievementActionHint;
};

export type AchievementRecommendation = SerializedAchievementForRecommendation & {
  recommendationGroup: AchievementRecommendationGroup;
  recommendationReason: string;
  remainingEffortLabel: string;
  targetSection: AchievementActionHint["section"];
};

export type AchievementRecommendations = Record<AchievementRecommendationGroup, AchievementRecommendation[]>;

type RuleConfigWithMeta = {
  meta?: Partial<AchievementMetadata>;
  count?: number;
  days?: number;
  minutes?: number;
  rank?: number;
};

export function readAchievementMetadata(input: {
  code: string;
  ruleType: AchievementRuleType;
  ruleConfig: Prisma.JsonValue;
}): AchievementMetadata {
  const config = toRuleConfig(input.ruleConfig);
  const meta = config.meta ?? {};
  const category = normalizeCategory(meta.category) ?? defaultCategory(input.ruleType);
  return {
    category,
    rarity: normalizeRarity(meta.rarity) ?? defaultRarity(input.ruleType),
    weight: typeof meta.weight === "number" ? meta.weight : defaultWeight(input.ruleType),
    todayFriendly:
      typeof meta.todayFriendly === "boolean"
        ? meta.todayFriendly
        : defaultTodayFriendly(input.ruleType),
    unlockSummary:
      typeof meta.unlockSummary === "string" && meta.unlockSummary.trim()
        ? meta.unlockSummary
        : defaultUnlockSummary(input.ruleType, config),
    actionHint: normalizeActionHint(meta.actionHint) ?? defaultActionHint(category)
  };
}

export function buildAchievementRecommendations(
  achievements: SerializedAchievementForRecommendation[]
): AchievementRecommendations {
  const locked = achievements.filter(
    (achievement) => !achievement.unlockedAt && !achievement.progress.completed
  );
  const byStableCode = (left: SerializedAchievementForRecommendation, right: SerializedAchievementForRecommendation) =>
    left.code.localeCompare(right.code);

  const nearest = [...locked]
    .sort((left, right) => {
      const byPercent = right.progress.percent - left.progress.percent;
      if (byPercent !== 0) return byPercent;
      const leftRemaining = remainingEffort(left.progress);
      const rightRemaining = remainingEffort(right.progress);
      if (leftRemaining !== rightRemaining) return leftRemaining - rightRemaining;
      return byStableCode(left, right);
    })
    .slice(0, 3);

  const today = [...locked]
    .filter((achievement) => achievement.todayFriendly)
    .sort((left, right) => {
      const byWeight = right.recommendationWeight - left.recommendationWeight;
      if (byWeight !== 0) return byWeight;
      const byPercent = right.progress.percent - left.progress.percent;
      if (byPercent !== 0) return byPercent;
      return byStableCode(left, right);
    })
    .slice(0, 3);

  const longTerm = [...locked]
    .filter((achievement) => !today.some((item) => item.id === achievement.id))
    .sort((left, right) => {
      const byRarity = rarityRank(right.rarity) - rarityRank(left.rarity);
      if (byRarity !== 0) return byRarity;
      const byWeight = right.recommendationWeight - left.recommendationWeight;
      if (byWeight !== 0) return byWeight;
      return byStableCode(left, right);
    })
    .slice(0, 3);

  return {
    nearest: nearest.map((achievement) => withRecommendationContext(achievement, "nearest")),
    today: today.map((achievement) => withRecommendationContext(achievement, "today")),
    long_term: longTerm.map((achievement) => withRecommendationContext(achievement, "long_term"))
  };
}

function toRuleConfig(value: Prisma.JsonValue): RuleConfigWithMeta {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function normalizeCategory(value: unknown): AchievementCategory | null {
  return typeof value === "string" && achievementCategories.includes(value as AchievementCategory)
    ? (value as AchievementCategory)
    : null;
}

function normalizeRarity(value: unknown): AchievementMetadata["rarity"] | null {
  return typeof value === "string" &&
    ["common", "uncommon", "rare", "epic", "legendary"].includes(value)
    ? (value as AchievementMetadata["rarity"])
    : null;
}

function normalizeActionHint(value: unknown): AchievementActionHint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const maybe = value as Partial<AchievementActionHint>;
  if (
    typeof maybe.section !== "string" ||
    !["home", "activities", "beans", "leaderboards", "profile"].includes(maybe.section) ||
    typeof maybe.label !== "string"
  ) {
    return null;
  }
  return { section: maybe.section as AchievementActionHint["section"], label: maybe.label };
}

function defaultCategory(ruleType: AchievementRuleType): AchievementCategory {
  if (ruleType === AchievementRuleType.first_checkin || ruleType === AchievementRuleType.streak || ruleType === AchievementRuleType.total_duration) {
    return "check_in";
  }
  if (ruleType === AchievementRuleType.activity_count) return "activity";
  if (ruleType === AchievementRuleType.collection_count) return "bean_draw";
  if (ruleType === AchievementRuleType.weekly_top_rank) return "leaderboard";
  return "new_user";
}

function defaultRarity(ruleType: AchievementRuleType): AchievementMetadata["rarity"] {
  if (ruleType === AchievementRuleType.weekly_top_rank) return "legendary";
  if (ruleType === AchievementRuleType.streak || ruleType === AchievementRuleType.collection_count) return "rare";
  if (ruleType === AchievementRuleType.total_duration || ruleType === AchievementRuleType.activity_count) return "uncommon";
  return "common";
}

function defaultWeight(ruleType: AchievementRuleType): number {
  if (ruleType === AchievementRuleType.first_checkin) return 100;
  if (ruleType === AchievementRuleType.activity_count) return 80;
  if (ruleType === AchievementRuleType.total_duration) return 70;
  if (ruleType === AchievementRuleType.collection_count) return 60;
  if (ruleType === AchievementRuleType.streak) return 50;
  return 30;
}

function defaultTodayFriendly(ruleType: AchievementRuleType): boolean {
  return (
    ruleType === AchievementRuleType.first_checkin ||
    ruleType === AchievementRuleType.total_duration ||
    ruleType === AchievementRuleType.activity_count ||
    ruleType === AchievementRuleType.collection_count
  );
}

function defaultUnlockSummary(ruleType: AchievementRuleType, config: RuleConfigWithMeta): string {
  if (ruleType === AchievementRuleType.first_checkin) return "完成第一次有效打卡";
  if (ruleType === AchievementRuleType.streak) return `连续休息 ${config.days ?? 1} 天`;
  if (ruleType === AchievementRuleType.total_duration) return `累计有效休息 ${config.minutes ?? 1} 分钟`;
  if (ruleType === AchievementRuleType.activity_count) return `完成 ${config.count ?? 1} 个摸鱼活动`;
  if (ruleType === AchievementRuleType.collection_count) return `收集 ${config.count ?? 1} 种命运豆`;
  if (ruleType === AchievementRuleType.weekly_top_rank) return `进入周榜前 ${config.rank ?? 10}`;
  return "完成指定摸鱼目标";
}

function defaultActionHint(category: AchievementCategory): AchievementActionHint {
  if (category === "activity") return { section: "activities", label: "去做活动" };
  if (category === "bean_draw") return { section: "beans", label: "去抽豆" };
  if (category === "leaderboard") return { section: "leaderboards", label: "去看排行" };
  return { section: "home", label: "去打卡" };
}

function remainingEffort(progress: AchievementProgress): number {
  if (progress.unit === "rank") {
    return progress.current > 0 ? Math.max(0, progress.current - progress.target) : 999;
  }
  return Math.max(0, progress.target - progress.current);
}

function withRecommendationContext(
  achievement: SerializedAchievementForRecommendation,
  group: AchievementRecommendationGroup
): AchievementRecommendation {
  return {
    ...achievement,
    recommendationGroup: group,
    recommendationReason: recommendationReason(group, achievement),
    remainingEffortLabel: remainingEffortLabel(achievement.progress),
    targetSection: achievement.actionHint.section
  };
}

function recommendationReason(
  group: AchievementRecommendationGroup,
  achievement: SerializedAchievementForRecommendation
): string {
  if (group === "nearest") {
    return achievement.progress.percent >= 80
      ? "已经快摸到边了，顺手补一下就能解锁。"
      : "这是当前进度最接近完成的目标之一。";
  }
  if (group === "today") {
    return "今天的常规摸鱼动作就能推进它，不用额外折腾。";
  }
  return "适合慢慢追，不错过、不补课，也没有付费恢复。";
}

function remainingEffortLabel(progress: AchievementProgress): string {
  if (progress.completed) {
    return "已经完成";
  }
  if (progress.unit === "rank") {
    return progress.current > 0
      ? `还差 ${Math.max(0, progress.current - progress.target)} 名进入目标`
      : `进入前 ${progress.target} 即可`;
  }
  const remaining = Math.max(0, progress.target - progress.current);
  if (progress.unit === "minutes") {
    return `还差 ${remaining} 分钟`;
  }
  return `还差 ${remaining} 次`;
}

function rarityRank(rarity: AchievementMetadata["rarity"]): number {
  return { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 }[rarity];
}
