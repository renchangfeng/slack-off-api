import type { ActivityCategory, ActivityFeedbackType } from "@prisma/client";

export const canonicalActivityCategories = [
  "rest",
  "game",
  "office_theater",
  "physical",
  "imagination"
] as const;

export type CanonicalActivityCategory = (typeof canonicalActivityCategories)[number];

export type ActivityInteractionSignalSummary = {
  estimatedSeconds: number;
  hasTimer: boolean;
  hasMiniGame: boolean;
  hasChoice?: boolean;
  hasTapPattern?: boolean;
  hasShufflePick?: boolean;
  hasSort?: boolean;
  hasBreath?: boolean;
  hasReaction?: boolean;
  hasMicroJournal?: boolean;
  hasReveal?: boolean;
};

export type ActivityFlavor =
  | "quick"
  | "weird"
  | "recharge"
  | "tiny_challenge"
  | "tiny_reflection";

export const activityFlavors: ActivityFlavor[] = [
  "quick",
  "weird",
  "recharge",
  "tiny_challenge",
  "tiny_reflection"
];

export function isActivityFlavor(value: string | undefined): value is ActivityFlavor {
  return activityFlavors.includes(value as ActivityFlavor);
}

export function flavorLabel(flavor: ActivityFlavor): string {
  return {
    quick: "快速完成",
    weird: "脑洞一点",
    recharge: "充电恢复",
    tiny_challenge: "小挑战",
    tiny_reflection: "小反思"
  }[flavor];
}

export type RecommendationCandidate<T> = {
  value: T;
  category: CanonicalActivityCategory;
  eligible: boolean;
  difficulty?: string;
  flavor?: ActivityFlavor;
  interactionSummary?: ActivityInteractionSignalSummary;
  completedCount: number;
  categoryCompletionCount: number;
  lastUsedAt: Date | null;
};

export const activitySkipReasons = [
  "too_much_work",
  "not_interested",
  "not_convenient",
  "want_weirder",
  "other"
] as const;

export type ActivitySkipReason = (typeof activitySkipReasons)[number];

export type ActivityFeedbackSignal = {
  templateId: string;
  category: CanonicalActivityCategory;
  flavor?: ActivityFlavor;
  feedbackType: ActivityFeedbackType;
  createdAt: Date;
};

export type RecommendationReason =
  | "PREFERRED_CATEGORY"
  | "TRY_SOMETHING_NEW"
  | "MATCHES_HISTORY"
  | "AVAILABLE_NOW"
  | "LIKED_CATEGORY"
  | "LIKED_FLAVOR"
  | "SHORTER_AFTER_FEEDBACK"
  | "WEIRDER_AFTER_FEEDBACK"
  | "AVOIDED_RECENT_DISLIKE"
  | "AVOIDED_PHYSICAL";

export type RecommendationResult<T> = {
  value: T;
  score: number;
  reason: RecommendationReason;
  flavor?: ActivityFlavor;
};

export function explainActivityRecommendation(input: {
  reason: RecommendationResult<unknown>["reason"] | "ACTIVE_ASSIGNMENT";
  preferredCategory?: CanonicalActivityCategory;
  flavor?: ActivityFlavor;
  recentSkipReasons?: ActivitySkipReason[];
}): string {
  if (input.reason === "ACTIVE_ASSIGNMENT") {
    return "你已经有一个进行中的任务，先把这次摸鱼坐实。";
  }
  if (input.reason === "LIKED_CATEGORY") {
    return "按你最近觉得有意思的类型推荐，手感应该更接近。";
  }
  if (input.reason === "LIKED_FLAVOR" && input.flavor) {
    return `按你最近偏好的${flavorLabel(input.flavor)}风格推荐，应该更对你的口味。`;
  }
  if (input.reason === "SHORTER_AFTER_FEEDBACK") {
    return "你最近想短一点，所以这次优先轻量快速完成。";
  }
  if (input.reason === "WEIRDER_AFTER_FEEDBACK") {
    return "你最近想来点更怪的，所以这次偏脑洞和表演一点。";
  }
  if (input.reason === "AVOIDED_RECENT_DISLIKE") {
    return "你最近不太想重复类似任务，所以这次换个方向。";
  }
  if (input.reason === "AVOIDED_PHYSICAL") {
    return "你最近不想太折腾，所以这次少安排身体动作。";
  }
  if (input.recentSkipReasons?.includes("want_weirder")) {
    return "刚才你想来点怪的，所以这次偏脑洞和表演一点。";
  }
  if (input.recentSkipReasons?.includes("not_convenient")) {
    return "刚才你觉得不方便，所以这次尽量避开太折腾的任务。";
  }
  if (input.recentSkipReasons?.includes("too_much_work")) {
    return "刚才你嫌太麻烦，所以这次优先挑轻一点的任务。";
  }
  if (input.reason === "PREFERRED_CATEGORY" && input.preferredCategory) {
    return `按你选的${categoryLabel(input.preferredCategory)}偏好推荐。`;
  }
  if (input.reason === "TRY_SOMETHING_NEW") {
    return "这项你还没怎么做过，适合换个频道试一下。";
  }
  if (input.reason === "MATCHES_HISTORY") {
    return "按你最近完成过的类型继续推荐，手感应该比较顺。";
  }
  return "当前可做且冷却通过，适合顺手完成。";
}

export function normalizeActivityCategory(
  category: ActivityCategory | string
): CanonicalActivityCategory {
  if (category === "tiny_task" || category === "absurd") {
    return "imagination";
  }

  return category as CanonicalActivityCategory;
}

function categoryLabel(category: CanonicalActivityCategory): string {
  return {
    rest: "安静休息",
    game: "小游戏",
    office_theater: "办公室表演",
    physical: "身体活动",
    imagination: "脑洞任务"
  }[category];
}

export function isCanonicalActivityCategory(
  value: string | undefined
): value is CanonicalActivityCategory {
  return canonicalActivityCategories.includes(value as CanonicalActivityCategory);
}

export function recommendActivity<T>(
  candidates: RecommendationCandidate<T>[],
  options: {
    preferredCategory?: CanonicalActivityCategory;
    recentSkipReasons?: ActivitySkipReason[];
    feedbackSignals?: ActivityFeedbackSignal[];
    now: Date;
    random?: () => number;
  }
): RecommendationResult<T> | null {
  const feedbackSummary = summarizeFeedbackSignals(options.feedbackSignals ?? []);
  const scored = candidates
    .filter((candidate) => candidate.eligible)
    .map((candidate) => {
      let score = 10;
      let reason: RecommendationResult<T>["reason"] = "AVAILABLE_NOW";
      let feedbackReason: RecommendationReason | null = null;

      if (candidate.category === options.preferredCategory) {
        score += 20;
        reason = "PREFERRED_CATEGORY";
      }

      if (candidate.completedCount === 0) {
        score += 12;
        if (reason === "AVAILABLE_NOW") {
          reason = "TRY_SOMETHING_NEW";
        }
      } else if (candidate.categoryCompletionCount > 0) {
        score += Math.min(candidate.categoryCompletionCount, 5) * 2;
        if (reason === "AVAILABLE_NOW") {
          reason = "MATCHES_HISTORY";
        }
      }

      if (
        candidate.lastUsedAt &&
        options.now.getTime() - candidate.lastUsedAt.getTime() < 24 * 60 * 60 * 1000
      ) {
        score -= 8;
      }

      for (const skipReason of options.recentSkipReasons ?? []) {
        if (
          skipReason === "too_much_work" &&
          (candidate.difficulty === "hard" || (candidate.interactionSummary?.estimatedSeconds ?? 0) > 60)
        ) {
          score -= 7;
        }

        if (
          skipReason === "not_convenient" &&
          (candidate.category === "physical" || candidate.interactionSummary?.hasTimer)
        ) {
          score -= 6;
        }

        if (skipReason === "not_interested" && candidate.completedCount > 0) {
          score -= 5;
        }

        if (
          skipReason === "want_weirder" &&
          (candidate.category === "imagination" || candidate.category === "office_theater")
        ) {
          score += 14;
          if (reason === "AVAILABLE_NOW") {
            reason = "TRY_SOMETHING_NEW";
          }
        }
      }

      const feedbackScore = scoreFeedbackCandidate(candidate, feedbackSummary);
      score += feedbackScore.score;
      feedbackReason = feedbackScore.reason;

      return {
        value: candidate.value,
        score,
        reason: feedbackReason ?? reason,
        flavor: candidate.flavor
      };
    })
    .sort((left, right) => right.score - left.score);

  if (scored.length === 0) {
    return null;
  }

  const topBand = scored.filter((candidate) => candidate.score >= scored[0].score - 4);
  const random = options.random ?? Math.random;
  return topBand[Math.floor(random() * topBand.length)];
}

function summarizeFeedbackSignals(signals: ActivityFeedbackSignal[]) {
  const likedCategories = new Map<CanonicalActivityCategory, number>();
  const likedFlavors = new Map<ActivityFlavor, number>();
  const dislikedTemplates = new Set<string>();
  const dislikedCategories = new Map<CanonicalActivityCategory, number>();
  let wantsWeirder = 0;
  let wantsShorterOrEasier = 0;
  let avoidsPhysical = 0;

  for (const signal of signals) {
    if (signal.feedbackType === "liked") {
      likedCategories.set(signal.category, (likedCategories.get(signal.category) ?? 0) + 1);
      if (signal.flavor) {
        likedFlavors.set(signal.flavor, (likedFlavors.get(signal.flavor) ?? 0) + 1);
      }
    }
    if (signal.feedbackType === "dislike_similar") {
      dislikedTemplates.add(signal.templateId);
      dislikedCategories.set(signal.category, (dislikedCategories.get(signal.category) ?? 0) + 1);
    }
    if (signal.feedbackType === "want_weirder") {
      wantsWeirder += 1;
    }
    if (
      signal.feedbackType === "too_much_work" ||
      signal.feedbackType === "too_long" ||
      signal.feedbackType === "shorter"
    ) {
      wantsShorterOrEasier += 1;
    }
    if (signal.feedbackType === "too_physical") {
      avoidsPhysical += 1;
    }
  }

  return {
    likedCategories,
    likedFlavors,
    dislikedTemplates,
    dislikedCategories,
    wantsWeirder: Math.min(wantsWeirder, 3),
    wantsShorterOrEasier: Math.min(wantsShorterOrEasier, 3),
    avoidsPhysical: Math.min(avoidsPhysical, 3)
  };
}

function scoreFeedbackCandidate<T>(
  candidate: RecommendationCandidate<T>,
  summary: ReturnType<typeof summarizeFeedbackSignals>
): { score: number; reason: RecommendationReason | null } {
  let score = 0;
  let reason: RecommendationReason | null = null;
  const interaction = candidate.interactionSummary;
  const candidateId = templateIdForCandidate(candidate.value);
  const likedCategoryCount = summary.likedCategories.get(candidate.category) ?? 0;
  if (likedCategoryCount > 0) {
    score += Math.min(likedCategoryCount, 3) * 8;
    reason = "LIKED_CATEGORY";
  }

  if (candidate.flavor) {
    const likedFlavorCount = summary.likedFlavors.get(candidate.flavor) ?? 0;
    if (likedFlavorCount > 0) {
      score += Math.min(likedFlavorCount, 3) * 6;
      reason = "LIKED_FLAVOR";
    }
  }

  if (candidateId && summary.dislikedTemplates.has(candidateId)) {
    score -= 12;
    reason = "AVOIDED_RECENT_DISLIKE";
  }
  const dislikedCategoryCount = summary.dislikedCategories.get(candidate.category) ?? 0;
  if (dislikedCategoryCount > 0) {
    score -= Math.min(dislikedCategoryCount, 2) * 6;
    reason = "AVOIDED_RECENT_DISLIKE";
  }

  if (summary.wantsWeirder > 0) {
    if (candidate.category === "imagination" || candidate.category === "office_theater") {
      score += summary.wantsWeirder * 12;
      reason = "WEIRDER_AFTER_FEEDBACK";
    } else if (interaction?.hasChoice || interaction?.hasReveal || interaction?.hasShufflePick) {
      score += summary.wantsWeirder * 4;
      reason = "WEIRDER_AFTER_FEEDBACK";
    }
  }

  if (summary.wantsShorterOrEasier > 0) {
    if (candidate.difficulty === "hard" || (interaction?.estimatedSeconds ?? 0) > 60 || interaction?.hasTimer) {
      score -= summary.wantsShorterOrEasier * 8;
      reason = "SHORTER_AFTER_FEEDBACK";
    } else if ((interaction?.estimatedSeconds ?? 0) > 0 && (interaction?.estimatedSeconds ?? 0) < 45) {
      score += summary.wantsShorterOrEasier * 5;
      reason = "SHORTER_AFTER_FEEDBACK";
    }
  }

  if (summary.avoidsPhysical > 0) {
    if (candidate.category === "physical") {
      score -= summary.avoidsPhysical * 10;
      reason = "AVOIDED_PHYSICAL";
    } else if (interaction?.hasTimer || interaction?.hasTapPattern || interaction?.hasReaction) {
      score -= summary.avoidsPhysical * 4;
      reason = "AVOIDED_PHYSICAL";
    }
  }

  return { score, reason };
}

function templateIdForCandidate(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("id" in value)) {
    return null;
  }
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}
