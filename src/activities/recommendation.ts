import type { ActivityCategory } from "@prisma/client";

export const canonicalActivityCategories = [
  "rest",
  "game",
  "office_theater",
  "physical",
  "imagination"
] as const;

export type CanonicalActivityCategory = (typeof canonicalActivityCategories)[number];

export type RecommendationCandidate<T> = {
  value: T;
  category: CanonicalActivityCategory;
  eligible: boolean;
  difficulty?: string;
  interactionSummary?: {
    estimatedSeconds: number;
    hasTimer: boolean;
    hasMiniGame: boolean;
  };
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

export type RecommendationResult<T> = {
  value: T;
  score: number;
  reason: "PREFERRED_CATEGORY" | "TRY_SOMETHING_NEW" | "MATCHES_HISTORY" | "AVAILABLE_NOW";
};

export function normalizeActivityCategory(
  category: ActivityCategory | string
): CanonicalActivityCategory {
  if (category === "tiny_task" || category === "absurd") {
    return "imagination";
  }

  return category as CanonicalActivityCategory;
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
    now: Date;
    random?: () => number;
  }
): RecommendationResult<T> | null {
  const scored = candidates
    .filter((candidate) => candidate.eligible)
    .map((candidate) => {
      let score = 10;
      let reason: RecommendationResult<T>["reason"] = "AVAILABLE_NOW";

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

      return {
        value: candidate.value,
        score,
        reason
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
