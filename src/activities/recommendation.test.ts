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
});

function candidate(
  value: string,
  overrides: Partial<{
    category: "rest" | "game" | "office_theater" | "physical" | "imagination";
    eligible: boolean;
    completedCount: number;
    categoryCompletionCount: number;
    lastUsedAt: Date | null;
  }> = {}
) {
  return {
    value,
    category: overrides.category ?? (value === "physical" ? "physical" : "rest"),
    eligible: overrides.eligible ?? true,
    completedCount: overrides.completedCount ?? 1,
    categoryCompletionCount: overrides.categoryCompletionCount ?? 0,
    lastUsedAt: overrides.lastUsedAt ?? null
  };
}
