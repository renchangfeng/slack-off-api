import { BeanRarity } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  BEAN_PITY_THRESHOLD,
  deriveBeanCombinations,
  duplicateFragments,
  selectBean
} from "./rules.js";

describe("bean rules", () => {
  const pool = [
    { weight: 90, rarity: BeanRarity.common, code: "common" },
    { weight: 10, rarity: BeanRarity.rare, code: "rare" }
  ];

  it("exposes fish tank effect progress without consuming owned bean state", () => {
    const ownedCodes = new Set(["toilet_timer_bean", "flush_philosopher_bean"]);
    const before = [...ownedCodes];

    const restroom = deriveBeanCombinations(ownedCodes).find(
      (item) => item.code === "restroom_wisdom"
    );

    expect(restroom).toMatchObject({
      owned: 2,
      required: 3,
      completed: false,
      fishTankEffect: {
        type: "bubble_style",
        resourceType: "bubble",
        available: false
      }
    });
    expect([...ownedCodes]).toEqual(before);
  });

  it("marks a fish-linked combination available when every required bean is owned", () => {
    const restroom = deriveBeanCombinations(
      new Set(["toilet_timer_bean", "flush_philosopher_bean", "stall_sage_bean"])
    ).find((item) => item.code === "restroom_wisdom");

    expect(restroom).toMatchObject({
      owned: 3,
      required: 3,
      completed: true,
      fishTankEffect: {
        label: "哲学气泡",
        available: true
      }
    });
  });

  it("forces rare-or-better at the pity threshold", () => {
    const result = selectBean(pool, BEAN_PITY_THRESHOLD - 1, () => 0);
    expect(result.bean.code).toBe("rare");
    expect(result.pityTriggered).toBe(true);
    expect(result.nextPityCount).toBe(0);
  });

  it("increments pity after a low-rarity draw", () => {
    expect(selectBean(pool, 2, () => 0)).toMatchObject({
      bean: { code: "common" },
      nextPityCount: 3
    });
  });

  it("grants more fragments for rarer duplicates", () => {
    expect(duplicateFragments.legendary).toBeGreaterThan(duplicateFragments.common);
  });
});
