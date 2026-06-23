import { describe, expect, it } from "vitest";
import { createDailyGoals, createWeeklyGoals, utcWeekRange } from "./goals.js";

describe("progression goals", () => {
  it("starts the UTC week on Monday", () => {
    const range = utcWeekRange(new Date("2026-06-23T08:00:00.000Z"));
    expect(range.start.toISOString()).toBe("2026-06-22T00:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-06-29T00:00:00.000Z");
  });

  it("reports partial daily values", () => {
    const goals = createDailyGoals({ checkIns: 1, activities: 0, beanDraws: 0 });
    expect(goals).toEqual([
      expect.objectContaining({ code: "check_in", current: 1, target: 1, completed: true }),
      expect.objectContaining({ code: "activity", current: 0, target: 1, completed: false }),
      expect.objectContaining({ code: "bean_draw", current: 0, target: 1, completed: false })
    ]);
  });

  it("caps completion by comparing current values to weekly targets", () => {
    const goals = createWeeklyGoals({ restMinutes: 65, activities: 7, activeDays: 3 });
    expect(goals.every((goal) => goal.completed)).toBe(true);
  });
});
