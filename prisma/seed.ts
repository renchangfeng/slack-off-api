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
    rewardConfig: { score: 10, drawProgress: 1 }
  },
  {
    code: "three_day_streak",
    name: "三日不卷",
    description: "连续三天记得给自己一点空隙。",
    ruleType: AchievementRuleType.streak,
    ruleConfig: { days: 3 },
    rewardConfig: { score: 30, drawChance: 1 }
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
    code: "rename_temp_file",
    title: "把一个临时文件改名为 final_v2",
    description: "仪式感到了，工作就像推进了。",
    category: ActivityCategory.tiny_task,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: { score: 4 },
    cooldownSeconds: 60 * 60 * 2,
    dailyRewardLimit: 2
  }
];

async function main() {
  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          beans: beans.length,
          cosmetics: cosmetics.length,
          achievements: achievements.length,
          activities: activities.length
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
