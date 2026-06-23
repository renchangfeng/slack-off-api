import { describe, expect, it } from "vitest";
import { calculateProgressionLevel, utcDayRange } from "./calculate.js";

describe("calculateProgressionLevel", () => {
  it("starts new users at level one", () => {
    expect(calculateProgressionLevel(0)).toEqual({
      level: 1,
      experience: 0,
      currentLevelExperience: 0,
      nextLevelExperience: 100,
      progressPercent: 0
    });
  });

  it("advances at each one hundred experience boundary", () => {
    expect(calculateProgressionLevel(275)).toMatchObject({
      level: 3,
      experience: 275,
      currentLevelExperience: 75,
      progressPercent: 75
    });
  });

  it("normalizes negative and fractional experience", () => {
    expect(calculateProgressionLevel(-2.5).experience).toBe(0);
    expect(calculateProgressionLevel(199.9)).toMatchObject({
      level: 2,
      currentLevelExperience: 99
    });
  });
});

describe("utcDayRange", () => {
  it("returns the UTC day boundaries", () => {
    const range = utcDayRange(new Date("2026-06-22T23:30:00.000Z"));
    expect(range.start.toISOString()).toBe("2026-06-22T00:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-06-23T00:00:00.000Z");
  });
});
