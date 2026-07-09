import { BeanRarity, type BeanDefinition } from "@prisma/client";

export const BEAN_PITY_THRESHOLD = 8;
export const FRAGMENTS_PER_DRAW = 10;

export const duplicateFragments: Record<BeanRarity, number> = {
  common: 1,
  uncommon: 2,
  rare: 4,
  epic: 8,
  legendary: 15
};

export const beanCombinations = [
  {
    code: "office_survival_kit",
    name: "工位生存套装",
    beanCodes: ["meeting_escape_bean", "boss_radar_bean", "spreadsheet_fog_bean"],
    fishTankEffect: {
      type: "care_flavor",
      resourceType: "food",
      label: "工位鱼食灵感",
      hint: "集齐后解锁一条鱼缸照料彩蛋，不会消耗豆子。"
    }
  },
  {
    code: "restroom_wisdom",
    name: "隔间智慧套装",
    beanCodes: ["toilet_timer_bean", "flush_philosopher_bean", "stall_sage_bean"],
    fishTankEffect: {
      type: "bubble_style",
      resourceType: "bubble",
      label: "哲学气泡",
      hint: "集齐后解锁鱼缸气泡彩蛋，不会消耗豆子。"
    }
  },
  {
    code: "daydream_departure",
    name: "精神提前下班套装",
    beanCodes: ["cloud_meeting_bean", "afternoon_portal_bean", "weekend_preview_bean"],
    fishTankEffect: {
      type: "hatch_preview",
      resourceType: "hatch_progress",
      label: "新邻居预告",
      hint: "集齐后点亮孵化预告，不会消耗豆子。"
    }
  }
] as const;

export function deriveBeanCombinations(ownedCodes: ReadonlySet<string>) {
  return beanCombinations.map((combination) => {
    const owned = combination.beanCodes.filter((code) => ownedCodes.has(code)).length;
    const completed = owned === combination.beanCodes.length;
    return {
      code: combination.code,
      name: combination.name,
      owned,
      required: combination.beanCodes.length,
      completed,
      fishTankEffect: {
        ...combination.fishTankEffect,
        available: completed
      }
    };
  });
}

export function selectBean<T extends Pick<BeanDefinition, "weight" | "rarity">>(
  pool: T[],
  pityCount: number,
  random = Math.random
): { bean: T; pityTriggered: boolean; nextPityCount: number } {
  const pityTriggered = pityCount + 1 >= BEAN_PITY_THRESHOLD;
  const eligible = pityTriggered
    ? pool.filter((bean) => ["rare", "epic", "legendary"].includes(bean.rarity))
    : pool;
  const selected = selectWeighted(eligible.length ? eligible : pool, random);
  const highRarity = ["rare", "epic", "legendary"].includes(selected.rarity);
  return {
    bean: selected,
    pityTriggered,
    nextPityCount: highRarity ? 0 : pityCount + 1
  };
}

function selectWeighted<T extends { weight: number }>(pool: T[], random: () => number): T {
  const totalWeight = pool.reduce((sum, bean) => sum + bean.weight, 0);
  let cursor = random() * totalWeight;
  for (const bean of pool) {
    cursor -= bean.weight;
    if (cursor <= 0) return bean;
  }
  return pool[pool.length - 1];
}
