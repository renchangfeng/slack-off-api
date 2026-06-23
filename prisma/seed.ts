import {
  AchievementRuleType,
  ActivityCategory,
  ActivityDifficulty,
  BeanRarity,
  CosmeticType,
  PrismaClient
} from "@prisma/client";

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

const beans = [
  {
    code: "toilet_timer_bean",
    name: "马桶计时豆",
    rarity: BeanRarity.common,
    description: "它不懂 KPI，但它懂你坐了多久。",
    weight: 60
  },
  {
    code: "meeting_escape_bean",
    name: "会议脱壳豆",
    rarity: BeanRarity.uncommon,
    description: "据说能让无效会议的灵魂先下班。",
    weight: 25
  },
  {
    code: "boss_radar_bean",
    name: "老板雷达豆",
    rarity: BeanRarity.rare,
    description: "没有真的雷达，但心虚时会变得很灵。",
    weight: 10
  },
  {
    code: "paid_pooper_bean",
    name: "带薪王者豆",
    rarity: BeanRarity.epic,
    description: "不是每一次久坐都有意义，但这颗有。",
    weight: 4
  },
  {
    code: "slack_king_bean",
    name: "摸鱼大王豆",
    rarity: BeanRarity.legendary,
    description: "传说级豆子，出现时请假装自己在思考架构。",
    weight: 1
  }
];

const cosmetics = [
  {
    code: "badge_slack_king",
    name: "摸鱼大王",
    description: "授予那些在节奏里偷偷喘气的人。",
    cosmeticType: CosmeticType.badge,
    rarity: BeanRarity.legendary
  },
  {
    code: "badge_paid_pooper",
    name: "带薪蹲坑先锋",
    description: "勇敢地把休息贯彻到底。",
    cosmeticType: CosmeticType.badge,
    rarity: BeanRarity.epic
  },
  {
    code: "title_workplace_philosopher",
    name: "工位哲学家",
    description: "看似发呆，实则在和宇宙对齐。",
    cosmeticType: CosmeticType.title,
    rarity: BeanRarity.rare
  }
];

const achievements = [
  {
    code: "first_paid_pooping",
    name: "第一次带薪坚持",
    description: "完成第一次打卡，恭喜你开始认真休息。",
    ruleType: AchievementRuleType.first_checkin,
    ruleConfig: { count: 1 },
    rewardConfig: { score: 10, drawProgress: 1, cosmeticCode: "badge_paid_pooper" }
  },
  {
    code: "three_day_streak",
    name: "三日不卷",
    description: "连续三天记得给自己一点空隙。",
    ruleType: AchievementRuleType.streak,
    ruleConfig: { days: 3 },
    rewardConfig: { score: 30, drawChance: 1, cosmeticCode: "title_workplace_philosopher" }
  },
  {
    code: "thirty_min_paid_rest",
    name: "半小时人生赢家",
    description: "累计 30 分钟有效休息，说明你已经掌握了工位呼吸法。",
    ruleType: AchievementRuleType.total_duration,
    ruleConfig: { minutes: 30 },
    rewardConfig: { score: 20, drawProgress: 1 }
  },
  {
    code: "bean_collection_starter",
    name: "拼豆入门",
    description: "收集 3 种不同的工位命运豆。",
    ruleType: AchievementRuleType.collection_count,
    ruleConfig: { count: 3 },
    rewardConfig: { score: 25, drawChance: 1 }
  },
  {
    code: "weekly_top_slacker",
    name: "摸鱼大王",
    description: "进入周榜前 10，短暂地向世界证明你很会休息。",
    ruleType: AchievementRuleType.weekly_top_rank,
    ruleConfig: { rank: 10 },
    rewardConfig: { score: 50, cosmeticCode: "badge_slack_king" }
  },
  {
    code: "activity_starter",
    name: "摸鱼试吃员",
    description: "完成 5 个随机摸鱼活动。",
    ruleType: AchievementRuleType.activity_count,
    ruleConfig: { count: 5 },
    rewardConfig: { score: 50 }
  }
];

const activities = [
  // Mini-games
  {
    code: "match_three_rounds",
    title: "完成消消乐 3 关",
    description: "不要解释，这是手眼协调训练。",
    category: ActivityCategory.game,
    difficulty: ActivityDifficulty.normal,
    rewardConfig: { score: 8, drawProgress: 1 },
    cooldownSeconds: 60 * 60 * 6,
    dailyRewardLimit: 1
  },
  {
    code: "minesweeper_corner",
    title: "扫雷开一小局",
    description: "不是逃避现实，是训练风险识别。",
    category: ActivityCategory.game,
    difficulty: ActivityDifficulty.normal,
    rewardConfig: { score: 7, drawProgress: 1 },
    cooldownSeconds: 60 * 60 * 4,
    dailyRewardLimit: 1
  },
  {
    code: "word_puzzle",
    title: "猜一个五字母单词",
    description: "脑子需要换个频道，哪怕只换五格。",
    category: ActivityCategory.game,
    difficulty: ActivityDifficulty.normal,
    rewardConfig: { score: 7, drawProgress: 1 },
    cooldownSeconds: 60 * 60 * 4,
    dailyRewardLimit: 1
  },
  {
    code: "solitaire_round",
    title: "打一局纸牌接龙",
    description: "把混乱排成四摞，获得短暂控制感。",
    category: ActivityCategory.game,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: { score: 5 },
    cooldownSeconds: 60 * 60 * 2,
    dailyRewardLimit: 2
  },
  {
    code: "sudoku_row",
    title: "填完数独的一行",
    description: "只填一行，不负责拯救整个九宫格。",
    category: ActivityCategory.game,
    difficulty: ActivityDifficulty.normal,
    rewardConfig: { score: 6 },
    cooldownSeconds: 60 * 60 * 3,
    dailyRewardLimit: 2
  },
  {
    code: "memory_cards",
    title: "玩一轮翻牌记忆",
    description: "确认短期记忆还没有被会议彻底占满。",
    category: ActivityCategory.game,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: { score: 5 },
    cooldownSeconds: 60 * 60 * 2,
    dailyRewardLimit: 2
  },

  // Rest
  {
    code: "stare_at_water",
    title: "认真盯着水杯 30 秒",
    description: "假装你在分析液体动力学。",
    category: ActivityCategory.rest,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: { score: 3 },
    cooldownSeconds: 60 * 30,
    dailyRewardLimit: 3
  },
  {
    code: "window_distance",
    title: "看向远处 60 秒",
    description: "让眼睛临时离开像素，也让灵魂离开需求文档。",
    category: ActivityCategory.rest,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: { score: 3 },
    cooldownSeconds: 60 * 30,
    dailyRewardLimit: 3
  },
  {
    code: "silent_minute",
    title: "安静坐满 1 分钟",
    description: "什么都不解决，也是一种稀缺能力。",
    category: ActivityCategory.rest,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: { score: 4 },
    cooldownSeconds: 60 * 45,
    dailyRewardLimit: 3
  },
  {
    code: "warm_drink",
    title: "慢慢喝三口水",
    description: "不要一饮而尽，给每一口一点流程感。",
    category: ActivityCategory.rest,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: { score: 3 },
    cooldownSeconds: 60 * 30,
    dailyRewardLimit: 4
  },
  {
    code: "close_eyes",
    title: "闭眼休息 45 秒",
    description: "不是睡着，只是暂时拒绝接收视觉需求。",
    category: ActivityCategory.rest,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: { score: 3 },
    cooldownSeconds: 60 * 45,
    dailyRewardLimit: 3
  },
  {
    code: "desk_breathing",
    title: "做 5 次慢呼吸",
    description: "吸气，呼气，暂时不分析任何根因。",
    category: ActivityCategory.rest,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: { score: 4 },
    cooldownSeconds: 60 * 45,
    dailyRewardLimit: 3
  },

  // Office theater
  {
    code: "fake_loading_face",
    title: "保持加载中表情 1 分钟",
    description: "眉头微皱，像是在等一个很重要的接口。",
    category: ActivityCategory.office_theater,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: { score: 5 },
    cooldownSeconds: 60 * 60,
    dailyRewardLimit: 2
  },
  {
    code: "strategic_notebook",
    title: "翻开笔记本沉思 45 秒",
    description: "不用写字，留白本身就是高级方案。",
    category: ActivityCategory.office_theater,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: { score: 4 },
    cooldownSeconds: 60 * 60,
    dailyRewardLimit: 2
  },
  {
    code: "calendar_inspection",
    title: "严肃检查一次日历",
    description: "确认今天确实存在，然后放心地合上。",
    category: ActivityCategory.office_theater,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: { score: 4 },
    cooldownSeconds: 60 * 60,
    dailyRewardLimit: 2
  },
  {
    code: "architecture_stare",
    title: "盯着一张图思考 1 分钟",
    description: "任何图都可以，关键是看起来像在权衡架构。",
    category: ActivityCategory.office_theater,
    difficulty: ActivityDifficulty.normal,
    rewardConfig: { score: 5 },
    cooldownSeconds: 60 * 90,
    dailyRewardLimit: 2
  },
  {
    code: "keyboard_pause",
    title: "双手悬停在键盘上 30 秒",
    description: "像要写出关键代码，实际是在等待灵感上线。",
    category: ActivityCategory.office_theater,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: { score: 4 },
    cooldownSeconds: 60 * 60,
    dailyRewardLimit: 2
  },
  {
    code: "document_scroll",
    title: "缓慢滚动一页长文档",
    description: "不要求读懂，滚动速度要体现尊重。",
    category: ActivityCategory.office_theater,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: { score: 4 },
    cooldownSeconds: 60 * 60,
    dailyRewardLimit: 2
  },

  // Physical
  {
    code: "shoulder_rolls",
    title: "慢慢转动肩膀 6 次",
    description: "动作轻一点，不与工位进行力量对抗。",
    category: ActivityCategory.physical,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: { score: 5 },
    cooldownSeconds: 60 * 45,
    dailyRewardLimit: 3
  },
  {
    code: "desk_stretch",
    title: "站起来伸展 30 秒",
    description: "以舒服为准，不需要证明柔韧性。",
    category: ActivityCategory.physical,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: { score: 5 },
    cooldownSeconds: 60 * 45,
    dailyRewardLimit: 3
  },
  {
    code: "short_walk",
    title: "走到门口再回来",
    description: "一次极短的出走，路线安全即可。",
    category: ActivityCategory.physical,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: { score: 6, drawProgress: 1 },
    cooldownSeconds: 60 * 60,
    dailyRewardLimit: 2
  },
  {
    code: "wrist_release",
    title: "放松手腕 30 秒",
    description: "轻轻转动，不疼、不撑、不参加竞技。",
    category: ActivityCategory.physical,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: { score: 4 },
    cooldownSeconds: 60 * 30,
    dailyRewardLimit: 4
  },
  {
    code: "stand_and_sit",
    title: "缓慢起立再坐下 3 次",
    description: "量力而行，头晕或不适就直接跳过。",
    category: ActivityCategory.physical,
    difficulty: ActivityDifficulty.normal,
    rewardConfig: { score: 6 },
    cooldownSeconds: 60 * 60,
    dailyRewardLimit: 2
  },
  {
    code: "neck_reset",
    title: "轻轻活动颈部 20 秒",
    description: "只做舒适范围内的小幅动作，不要用力甩动。",
    category: ActivityCategory.physical,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: { score: 4 },
    cooldownSeconds: 60 * 45,
    dailyRewardLimit: 3
  },

  // Imagination
  {
    code: "rename_temp_file",
    title: "把一个临时文件改名为 final_v2",
    description: "仪式感到了，工作就像推进了。",
    category: ActivityCategory.imagination,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: { score: 4 },
    cooldownSeconds: 60 * 60 * 2,
    dailyRewardLimit: 2
  },
  {
    code: "invent_job_title",
    title: "给自己发明一个荒诞职称",
    description: "例如“跨部门空气协调专家”，不用告诉任何人。",
    category: ActivityCategory.imagination,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: { score: 5 },
    cooldownSeconds: 60 * 60 * 2,
    dailyRewardLimit: 2
  },
  {
    code: "alien_status_report",
    title: "用外星人语气总结今天",
    description: "地球项目仍在运行，碳基员工申请短暂冷却。",
    category: ActivityCategory.imagination,
    difficulty: ActivityDifficulty.normal,
    rewardConfig: { score: 6 },
    cooldownSeconds: 60 * 60 * 3,
    dailyRewardLimit: 1
  },
  {
    code: "name_a_cloud",
    title: "给窗外的一朵云起名字",
    description: "没有云就给一块空白区域命名，流程照常。",
    category: ActivityCategory.imagination,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: { score: 4 },
    cooldownSeconds: 60 * 60,
    dailyRewardLimit: 2
  },
  {
    code: "tiny_movie_plot",
    title: "编一个 20 秒电影梗概",
    description: "主角必须是一件办公用品，结局可以开放。",
    category: ActivityCategory.imagination,
    difficulty: ActivityDifficulty.normal,
    rewardConfig: { score: 6, drawProgress: 1 },
    cooldownSeconds: 60 * 60 * 3,
    dailyRewardLimit: 1
  },
  {
    code: "future_message",
    title: "给下班后的自己留一句话",
    description: "可以是鼓励，也可以提醒不要再打开工作软件。",
    category: ActivityCategory.imagination,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: { score: 5 },
    cooldownSeconds: 60 * 60 * 2,
    dailyRewardLimit: 2
  }
];

async function main() {
  if (dryRun) {
    const categoryCounts = activities.reduce<Record<string, number>>((counts, activity) => {
      counts[activity.category] = (counts[activity.category] ?? 0) + 1;
      return counts;
    }, {});

    if (activities.length < 30 || Object.values(categoryCounts).some((count) => count < 6)) {
      throw new Error("Activity seed must contain at least 30 templates and 6 per category");
    }

    console.log(
      JSON.stringify(
        {
          beans: beans.length,
          cosmetics: cosmetics.length,
          achievements: achievements.length,
          activities: activities.length,
          activityCategories: categoryCounts
        },
        null,
        2
      )
    );
    return;
  }

  for (const bean of beans) {
    await prisma.beanDefinition.upsert({
      where: { code: bean.code },
      create: bean,
      update: bean
    });
  }

  for (const cosmetic of cosmetics) {
    await prisma.cosmetic.upsert({
      where: { code: cosmetic.code },
      create: cosmetic,
      update: cosmetic
    });
  }

  for (const achievement of achievements) {
    await prisma.achievement.upsert({
      where: { code: achievement.code },
      create: achievement,
      update: achievement
    });
  }

  for (const activity of activities) {
    await prisma.activityTemplate.upsert({
      where: { code: activity.code },
      create: activity,
      update: activity
    });
  }
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
