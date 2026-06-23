import { BeanRarity } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { BEAN_PITY_THRESHOLD, duplicateFragments, selectBean } from "./rules.js";

describe("bean rules", () => {
  const pool = [
    { weight: 90, rarity: BeanRarity.common, code: "common" },
    { weight: 10, rarity: BeanRarity.rare, code: "rare" }
  ];

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
