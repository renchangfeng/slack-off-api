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
    beanCodes: ["meeting_escape_bean", "boss_radar_bean", "spreadsheet_fog_bean"]
  },
  {
    code: "restroom_wisdom",
    name: "隔间智慧套装",
    beanCodes: ["toilet_timer_bean", "flush_philosopher_bean", "stall_sage_bean"]
  },
  {
    code: "daydream_departure",
    name: "精神提前下班套装",
    beanCodes: ["cloud_meeting_bean", "afternoon_portal_bean", "weekend_preview_bean"]
  }
] as const;

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
