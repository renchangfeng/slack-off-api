import { describe, expect, it } from "vitest";
import { normalizeActivityCategory, recommendActivity } from "./recommendation.js";

const now = new Date("2026-06-23T08:00:00.000Z");

describe("activity recommendations", () => {
  it("normalizes legacy categories into imagination", () => {
    expect(normalizeActivityCategory("tiny_task")).toBe("imagination");
    expect(normalizeActivityCategory("absurd")).toBe("imagination");
  });

  it("prioritizes an explicitly preferred category", () => {
    const result = recommendActivity(
      [
        candidate("rest", { completedCount: 0 }),
        candidate("physical", { completedCount: 4, categoryCompletionCount: 4 })
      ],
      { preferredCategory: "physical", now, random: () => 0 }
    );

    expect(result).toMatchObject({
      value: "physical",
      reason: "PREFERRED_CATEGORY"
    });
  });

  it("favors discovery and penalizes recent repetition", () => {
    const result = recommendActivity(
      [
        candidate("new", { completedCount: 0 }),
        candidate("recent", {
          completedCount: 2,
          categoryCompletionCount: 2,
          lastUsedAt: new Date(now.getTime() - 60_000)
        })
      ],
      { now, random: () => 0 }
    );

    expect(result).toMatchObject({
      value: "new",
      reason: "TRY_SOMETHING_NEW"
    });
  });

  it("excludes cooling-down candidates", () => {
    const result = recommendActivity(
      [candidate("blocked", { eligible: false }), candidate("ready")],
      { now, random: () => 0 }
    );

    expect(result?.value).toBe("ready");
  });

  it("uses recent skip feedback to avoid inconvenient timed activities", () => {
    const result = recommendActivity(
      [
        candidate("walk", {
          category: "physical",
          completedCount: 0,
          interactionSummary: { estimatedSeconds: 35, hasTimer: true, hasMiniGame: false }
        }),
        candidate("choice", {
          category: "imagination",
          completedCount: 0,
          interactionSummary: { estimatedSeconds: 20, hasTimer: false, hasMiniGame: false }
        })
      ],
      { now, recentSkipReasons: ["not_convenient"], random: () => 0 }
    );

    expect(result?.value).toBe("choice");
  });

  it("boosts weird activities when the user asks for something weirder", () => {
    const result = recommendActivity(
      [
        candidate("rest", { category: "rest", completedCount: 0 }),
        candidate("weird", { category: "office_theater", completedCount: 1 })
      ],
      { now, recentSkipReasons: ["want_weirder"], random: () => 0 }
    );

    expect(result?.value).toBe("weird");
  });
});

function candidate(
  value: string,
  overrides: Partial<{
    category: "rest" | "game" | "office_theater" | "physical" | "imagination";
    eligible: boolean;
    completedCount: number;
    categoryCompletionCount: number;
    lastUsedAt: Date | null;
    difficulty: string;
    interactionSummary: {
      estimatedSeconds: number;
      hasTimer: boolean;
      hasMiniGame: boolean;
    };
  }> = {}
) {
  return {
    value,
    category: overrides.category ?? (value === "physical" ? "physical" : "rest"),
    eligible: overrides.eligible ?? true,
    difficulty: overrides.difficulty ?? "easy",
    interactionSummary: overrides.interactionSummary,
    completedCount: overrides.completedCount ?? 1,
    categoryCompletionCount: overrides.categoryCompletionCount ?? 0,
    lastUsedAt: overrides.lastUsedAt ?? null
  };
}
