import {
  AchievementRuleType,
  ActivityCategory,
  ActivityDifficulty,
  BeanRarity,
  BeanTheme,
  CosmeticType,
  Prisma,
  PrismaClient
} from "@prisma/client";

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

const beans = [
  {
    code: "toilet_timer_bean",
    name: "马桶计时豆",
    rarity: BeanRarity.common,
    theme: BeanTheme.restroom,
    description: "它不懂 KPI，但它懂你坐了多久。",
    weight: 60
  },
  {
    code: "meeting_escape_bean",
    name: "会议脱壳豆",
    rarity: BeanRarity.uncommon,
    theme: BeanTheme.office,
    description: "据说能让无效会议的灵魂先下班。",
    weight: 25
  },
  {
    code: "boss_radar_bean",
    name: "老板雷达豆",
    rarity: BeanRarity.rare,
    theme: BeanTheme.office,
    description: "没有真的雷达，但心虚时会变得很灵。",
    weight: 10
  },
  {
    code: "paid_pooper_bean",
    name: "带薪王者豆",
    rarity: BeanRarity.epic,
    theme: BeanTheme.restroom,
    description: "不是每一次久坐都有意义，但这颗有。",
    weight: 4
  },
  {
    code: "slack_king_bean",
    name: "摸鱼大王豆",
    rarity: BeanRarity.legendary,
    theme: BeanTheme.daydream,
    description: "传说级豆子，出现时请假装自己在思考架构。",
    weight: 1
  },
  {
    code: "spreadsheet_fog_bean",
    name: "表格迷雾豆",
    rarity: BeanRarity.common,
    theme: BeanTheme.office,
    description: "打开表格后自动生成一种我很忙的气氛。",
    weight: 55
  },
  {
    code: "calendar_gap_bean",
    name: "日历缝隙豆",
    rarity: BeanRarity.uncommon,
    theme: BeanTheme.office,
    description: "专门住在两场会议之间那十五分钟里。",
    weight: 28
  },
  {
    code: "architecture_oracle_bean",
    name: "架构神谕豆",
    rarity: BeanRarity.epic,
    theme: BeanTheme.office,
    description: "盯着白板三分钟，偶尔会发出一句再抽象一层。",
    weight: 5
  },
  {
    code: "printer_peace_bean",
    name: "打印机和平豆",
    rarity: BeanRarity.common,
    theme: BeanTheme.office,
    description: "它不能修打印机，但能让你接受打印机。",
    weight: 50
  },
  {
    code: "flush_philosopher_bean",
    name: "冲水哲学豆",
    rarity: BeanRarity.common,
    theme: BeanTheme.restroom,
    description: "有些需求适合分析，有些适合听它远去。",
    weight: 55
  },
  {
    code: "soap_bubble_bean",
    name: "洗手泡泡豆",
    rarity: BeanRarity.uncommon,
    theme: BeanTheme.restroom,
    description: "认真洗手二十秒，也算完成一个清晰闭环。",
    weight: 26
  },
  {
    code: "stall_sage_bean",
    name: "隔间贤者豆",
    rarity: BeanRarity.rare,
    theme: BeanTheme.restroom,
    description: "在最安静的隔间里，短暂拥有答案。",
    weight: 11
  },
  {
    code: "cloud_meeting_bean",
    name: "云端会议豆",
    rarity: BeanRarity.common,
    theme: BeanTheme.daydream,
    description: "会议在云上举行，因此谁也找不到入口。",
    weight: 52
  },
  {
    code: "afternoon_portal_bean",
    name: "午后传送门豆",
    rarity: BeanRarity.uncommon,
    theme: BeanTheme.daydream,
    description: "据说能把三点二十传送到下班前五分钟。",
    weight: 25
  },
  {
    code: "weekend_preview_bean",
    name: "周末预览豆",
    rarity: BeanRarity.rare,
    theme: BeanTheme.daydream,
    description: "提前加载一点周末，但禁止用于取消真正的休息。",
    weight: 10
  },
  {
    code: "moonlight_overtime_bean",
    name: "月光拒绝加班豆",
    rarity: BeanRarity.epic,
    theme: BeanTheme.daydream,
    description: "月亮说今天到这里，系统表示收到。",
    weight: 4
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
    ruleConfig: {
      count: 1,
      meta: {
        category: "new_user",
        rarity: "common",
        weight: 100,
        todayFriendly: true,
        unlockSummary: "完成第一次有效打卡",
        actionHint: { section: "home", label: "去打卡" }
      }
    },
    rewardConfig: { score: 10, drawProgress: 1, cosmeticCode: "badge_paid_pooper" }
  },
  {
    code: "three_day_streak",
    name: "三日不卷",
    description: "连续三天记得给自己一点空隙。",
    ruleType: AchievementRuleType.streak,
    ruleConfig: {
      days: 3,
      meta: {
        category: "check_in",
        rarity: "rare",
        weight: 70,
        todayFriendly: false,
        unlockSummary: "连续 3 天完成有效休息",
        actionHint: { section: "home", label: "继续打卡" }
      }
    },
    rewardConfig: { score: 30, drawChance: 1, cosmeticCode: "title_workplace_philosopher" }
  },
  {
    code: "thirty_min_paid_rest",
    name: "半小时人生赢家",
    description: "累计 30 分钟有效休息，说明你已经掌握了工位呼吸法。",
    ruleType: AchievementRuleType.total_duration,
    ruleConfig: {
      minutes: 30,
      meta: {
        category: "check_in",
        rarity: "uncommon",
        weight: 75,
        todayFriendly: true,
        unlockSummary: "累计 30 分钟有效休息",
        actionHint: { section: "home", label: "开始休息" }
      }
    },
    rewardConfig: { score: 20, drawProgress: 1 }
  },
  {
    code: "bean_collection_starter",
    name: "拼豆入门",
    description: "收集 3 种不同的工位命运豆。",
    ruleType: AchievementRuleType.collection_count,
    ruleConfig: {
      count: 3,
      meta: {
        category: "bean_draw",
        rarity: "rare",
        weight: 65,
        todayFriendly: true,
        unlockSummary: "收集 3 种不同命运豆",
        actionHint: { section: "beans", label: "去抽豆" }
      }
    },
    rewardConfig: { score: 25, drawChance: 1 }
  },
  {
    code: "weekly_top_slacker",
    name: "摸鱼大王",
    description: "进入周榜前 10，短暂地向世界证明你很会休息。",
    ruleType: AchievementRuleType.weekly_top_rank,
    ruleConfig: {
      rank: 10,
      meta: {
        category: "leaderboard",
        rarity: "legendary",
        weight: 40,
        todayFriendly: false,
        unlockSummary: "进入周榜前 10",
        actionHint: { section: "leaderboards", label: "冲一下榜" }
      }
    },
    rewardConfig: { score: 50, cosmeticCode: "badge_slack_king" }
  },
  {
    code: "activity_starter",
    name: "摸鱼试吃员",
    description: "完成 5 个随机摸鱼活动。",
    ruleType: AchievementRuleType.activity_count,
    ruleConfig: {
      count: 5,
      meta: {
        category: "activity",
        rarity: "uncommon",
        weight: 85,
        todayFriendly: true,
        unlockSummary: "完成 5 个摸鱼活动",
        actionHint: { section: "activities", label: "去做活动" }
      }
    },
    rewardConfig: { score: 50 }
  }
];

const activityFlavors = new Set([
  "quick",
  "weird",
  "recharge",
  "tiny_challenge",
  "tiny_reflection"
]);

function withInteraction(
  rewardConfig: Prisma.InputJsonObject,
  interaction: Prisma.InputJsonObject,
  flavor?: string
) {
  return {
    ...rewardConfig,
    interaction,
    ...(flavor ? { flavor } : {})
  };
}

function withPresentation(
  rewardConfig: Prisma.InputJsonObject,
  presentation: Prisma.InputJsonObject
) {
  return {
    ...rewardConfig,
    presentation
  };
}

function presentationForActivity(code: string) {
  const presentation = activityPresentations[code];
  if (!presentation) {
    throw new Error(`Missing activity presentation for ${code}`);
  }
  return presentation;
}

function guidedInteraction(
  estimatedSeconds: number,
  proofPolicy: string,
  steps: Prisma.InputJsonValue[],
  completionFeedback: string[],
  resultSummary?: Prisma.InputJsonObject,
  flavorLabel?: string
) {
  return {
    mode: "guided",
    estimatedSeconds,
    proofPolicy,
    steps,
    completionFeedback,
    ...(resultSummary ? { resultSummary } : {}),
    ...(flavorLabel ? { flavorLabel } : {})
  };
}

const allowedStepTypes = new Set([
  "ack",
  "timer",
  "choice",
  "mini_game",
  "tap-pattern",
  "shuffle-pick",
  "sort",
  "breath",
  "reaction",
  "micro-journal",
  "reveal"
]);

const privacySafeProofPolicies = new Set(["none", "external_game"]);

function validateAuthoredInteraction(code: string, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Activity ${code} has malformed authored interaction`);
  }
  const interaction = value as {
    mode?: unknown;
    estimatedSeconds?: unknown;
    proofPolicy?: unknown;
    steps?: unknown;
  };
  if (interaction.mode !== "guided") {
    throw new Error(`Activity ${code} interaction mode must be "guided"`);
  }
  if (typeof interaction.estimatedSeconds !== "number") {
    throw new Error(`Activity ${code} interaction estimatedSeconds must be a number`);
  }
  if (
    typeof interaction.proofPolicy !== "string" ||
    !privacySafeProofPolicies.has(interaction.proofPolicy)
  ) {
    throw new Error(
      `Activity ${code} interaction proofPolicy must be privacy-safe (${[...privacySafeProofPolicies].join(", ")})`
    );
  }
  if (!Array.isArray(interaction.steps)) {
    throw new Error(`Activity ${code} interaction steps must be an array`);
  }
  for (const step of interaction.steps) {
    if (!step || typeof step !== "object" || Array.isArray(step)) {
      throw new Error(`Activity ${code} interaction step is malformed`);
    }
    const s = step as Record<string, unknown>;
    for (const key of ["id", "type", "title", "description"]) {
      if (typeof s[key] !== "string") {
        throw new Error(`Activity ${code} interaction step missing ${key}`);
      }
    }
    if (typeof s.required !== "boolean") {
      throw new Error(`Activity ${code} interaction step ${s.id} missing required boolean`);
    }
    if (!allowedStepTypes.has(s.type as string)) {
      throw new Error(`Activity ${code} interaction step ${s.id} has unsupported type ${s.type}`);
    }
    if (s.type === "timer" && typeof s.durationSeconds !== "number") {
      throw new Error(`Activity ${code} timer step ${s.id} missing durationSeconds`);
    }
    if (s.type === "choice") {
      if (!Array.isArray(s.options) || s.options.length === 0) {
        throw new Error(`Activity ${code} choice step ${s.id} missing options`);
      }
    }
    if (s.type === "mini_game" && typeof s.gameCode !== "string") {
      throw new Error(`Activity ${code} mini_game step ${s.id} missing gameCode`);
    }
    if (s.type === "tap-pattern" && typeof s.requiredTaps !== "number") {
      throw new Error(`Activity ${code} tap-pattern step ${s.id} missing requiredTaps`);
    }
    if (s.type === "shuffle-pick" || s.type === "reveal") {
      if (!Array.isArray(s.items) || s.items.length === 0) {
        throw new Error(`Activity ${code} ${s.type} step ${s.id} missing items`);
      }
    }
    if (s.type === "sort") {
      if (!Array.isArray(s.items) || s.items.length === 0) {
        throw new Error(`Activity ${code} sort step ${s.id} missing items`);
      }
    }
    if (s.type === "breath" && typeof s.requiredRounds !== "number") {
      throw new Error(`Activity ${code} breath step ${s.id} missing requiredRounds`);
    }
    if (s.type === "reaction" && typeof s.requiredSuccessCount !== "number") {
      throw new Error(`Activity ${code} reaction step ${s.id} missing requiredSuccessCount`);
    }
    if (s.type === "micro-journal") {
      if (s.journalMode !== "text" && s.journalMode !== "tags" && s.journalMode !== "both") {
        throw new Error(`Activity ${code} micro-journal step ${s.id} missing journalMode`);
      }
      if ((s.journalMode === "tags" || s.journalMode === "both") && !Array.isArray(s.tags)) {
        throw new Error(`Activity ${code} micro-journal step ${s.id} missing tags`);
      }
    }
  }
}

function validateAuthoredCopy(code: string, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Activity ${code} has malformed authored interaction for copy validation`);
  }
  const interaction = value as {
    steps?: unknown;
    completionFeedback?: unknown;
    resultSummary?: unknown;
  };
  if (!Array.isArray(interaction.completionFeedback) || interaction.completionFeedback.length === 0) {
    throw new Error(`Activity ${code} missing authored completionFeedback`);
  }
  if (interaction.completionFeedback.some((line) => typeof line !== "string" || !line.trim())) {
    throw new Error(`Activity ${code} has empty authored completionFeedback`);
  }
  const resultSummary = interaction.resultSummary;
  if (
    !resultSummary ||
    typeof resultSummary !== "object" ||
    Array.isArray(resultSummary) ||
    typeof (resultSummary as { title?: unknown }).title !== "string" ||
    !(resultSummary as { title?: string }).title?.trim() ||
    typeof (resultSummary as { copy?: unknown }).copy !== "string" ||
    !(resultSummary as { copy?: string }).copy?.trim()
  ) {
    throw new Error(`Activity ${code} missing authored resultSummary title/copy`);
  }
  if (!Array.isArray(interaction.steps)) {
    throw new Error(`Activity ${code} missing steps for copy validation`);
  }
  for (const step of interaction.steps) {
    if (!step || typeof step !== "object" || Array.isArray(step)) {
      throw new Error(`Activity ${code} step malformed during copy validation`);
    }
    const s = step as Record<string, unknown>;
    for (const key of ["title", "description"]) {
      const value = s[key];
      if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`Activity ${code} step ${s.id} missing authored ${key}`);
      }
    }
    if (s.type === "choice") {
      const options = s.options as Array<{ label?: unknown }> | undefined;
      if (!Array.isArray(options) || options.some((o) => typeof o.label !== "string" || !o.label.trim())) {
        throw new Error(`Activity ${code} choice step ${s.id} missing option labels`);
      }
    }
  }
}

function countWidgetUsage(activities: typeof rawActivities) {
  const counts: Record<string, number> = {};
  for (const type of allowedStepTypes) {
    counts[type] = 0;
  }
  for (const activity of activities) {
    const interaction = (activity.rewardConfig as { interaction?: { steps?: Array<{ type: string }> } }).interaction;
    if (!interaction?.steps) continue;
    for (const step of interaction.steps) {
      if (allowedStepTypes.has(step.type)) {
        counts[step.type] = (counts[step.type] ?? 0) + 1;
      }
    }
  }
  return counts;
}

function countWidgetTypeTemplates(activities: typeof rawActivities) {
  const counts: Record<string, number> = {};
  for (const type of allowedStepTypes) {
    counts[type] = 0;
  }
  for (const activity of activities) {
    const interaction = (activity.rewardConfig as { interaction?: { steps?: Array<{ type: string }> } }).interaction;
    if (!interaction?.steps) continue;
    const usedTypes = new Set(interaction.steps.map((step) => step.type));
    for (const type of usedTypes) {
      if (allowedStepTypes.has(type)) {
        counts[type] = (counts[type] ?? 0) + 1;
      }
    }
  }
  return counts;
}

function validateFlavor(code: string, rewardConfig: unknown) {
  if (!rewardConfig || typeof rewardConfig !== "object" || Array.isArray(rewardConfig)) {
    throw new Error(`Activity ${code} missing rewardConfig for flavor validation`);
  }
  const flavor = (rewardConfig as { flavor?: unknown }).flavor;
  if (typeof flavor !== "string" || !activityFlavors.has(flavor)) {
    throw new Error(
      `Activity ${code} missing or invalid flavor (got ${String(flavor)}). Allowed: ${[...activityFlavors].join(", ")}`
    );
  }
}

const rawActivities = [
  // Mini-games
  {
    code: "match_three_rounds",
    title: "完成消消乐 3 关",
    description: "不要解释，这是手眼协调训练。",
    category: ActivityCategory.game,
    difficulty: ActivityDifficulty.normal,
    rewardConfig: withInteraction(
      { score: 8, drawProgress: 1 },
      guidedInteraction(
        90,
        "external_game",
        [
          {
            id: "pick_game",
            type: "choice",
            title: "先选今天的通关姿势",
            description: "选一个你准备使用的摸鱼战术。",
            required: true,
            options: [
              { id: "combo", label: "连击流", resultText: "今天靠手速混过去。" },
              { id: "careful", label: "稳健流", resultText: "慢一点，但显得很专业。" },
              { id: "chaos", label: "随缘流", resultText: "命运会自己安排三消。" }
            ]
          },
          {
            id: "mini_game",
            type: "mini_game",
            title: "连点 5 下完成占位小游戏",
            description: "当前先用轻互动占位，后续可接独立小游戏工程。",
            required: true,
            gameCode: "tap_combo",
            requiredResult: "完成 5 次有效点击"
          }
        ],
        [
          "消消乐训练结束，大脑成功假装换了一块显卡。",
          "三关小混乱已被你体面消除，手指申请短暂表扬。"
        ],
        { title: "三消训练完成", copy: "大脑假装换了一块显卡，手指也假装参与了高级操作。" },
        "三消小游戏"
      ),
      "tiny_challenge"
    ),
    cooldownSeconds: 60 * 60 * 6,
    dailyRewardLimit: 1
  },
  {
    code: "minesweeper_corner",
    title: "扫雷开一小局",
    description: "不是逃避现实，是训练风险识别。",
    category: ActivityCategory.game,
    difficulty: ActivityDifficulty.normal,
    rewardConfig: withInteraction(
      { score: 7, drawProgress: 1 },
      guidedInteraction(
        70,
        "external_game",
        [
          {
            id: "risk_style",
            type: "choice",
            title: "选择扫雷人格",
            description: "今天你准备怎么面对未知格子？",
            required: true,
            options: [
              { id: "corner", label: "角落保守派", resultText: "从角落开始，安全感上线。" },
              { id: "middle", label: "中路莽夫", resultText: "勇气可嘉，风险自理。" },
              { id: "flagger", label: "标旗分析师", resultText: "每一面旗都像一份周报。" }
            ]
          },
          {
            id: "mini_game",
            type: "mini_game",
            title: "完成安全点击",
            description: "用占位小游戏模拟一次低风险决策。",
            required: true,
            gameCode: "safe_click",
            requiredResult: "完成一次安全点击"
          }
        ],
        [
          "扫雷训练结束，风险识别能力获得精神认证。",
          "你在虚拟雷区里保持了基本体面，现实风险先别过来。"
        ],
        { title: "风险识别完成", copy: "你刚刚严肃地处理了一块虚拟雷区，现实问题先排队。" },
        "风险小游戏"
      ),
      "tiny_challenge"
    ),
    cooldownSeconds: 60 * 60 * 4,
    dailyRewardLimit: 1
  },
  {
    code: "word_puzzle",
    title: "猜一个五字母单词",
    description: "脑子需要换个频道，哪怕只换五格。",
    category: ActivityCategory.game,
    difficulty: ActivityDifficulty.normal,
    rewardConfig: withInteraction(
      { score: 7, drawProgress: 1 },
      guidedInteraction(
        60,
        "external_game",
        [
          {
            id: "first_guess",
            type: "choice",
            title: "选择开局气质",
            description: "单词不重要，重要的是你看起来像在动脑。",
            required: true,
            options: [
              { id: "vowels", label: "元音侦察", resultText: "先找元音，像个讲策略的人。" },
              { id: "random", label: "灵感乱撞", resultText: "混沌也是一种算法。" },
              { id: "safe", label: "常用词保底", resultText: "稳一点，生活已经够刺激了。" }
            ]
          },
          {
            id: "mini_game",
            type: "mini_game",
            title: "完成字母选择",
            description: "用占位小游戏完成一次脑内换台。",
            required: true,
            gameCode: "word_pick",
            requiredResult: "完成一次字母选择"
          }
        ],
        [
          "五格脑力活动完成，语言中枢短暂复活。",
          "单词频道切换成功，工作脑获得一分钟后台休眠。"
        ],
        { title: "单词频道切换成功", copy: "工作脑暂时退后台，猜词脑上来透了口气。" },
        "字谜小游戏"
      ),
      "tiny_challenge"
    ),
    cooldownSeconds: 60 * 60 * 4,
    dailyRewardLimit: 1
  },
  {
    code: "solitaire_round",
    title: "打一局纸牌接龙",
    description: "把混乱排成四摞，获得短暂控制感。",
    category: ActivityCategory.game,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: withInteraction(
      { score: 5 },
      guidedInteraction(
        50,
        "external_game",
        [
          {
            id: "patience_style",
            type: "choice",
            title: "选择接龙策略",
            description: "决定今天怎么面对这堆牌。",
            required: true,
            options: [
              { id: "sort", label: "先排序", resultText: "先把能排的排好，剩下的交给命运。" },
              { id: "expose", label: "先翻牌", resultText: "把隐藏牌翻出来，信息优先。" },
              { id: "calm", label: "慢慢来", resultText: "不追速度，只追过程。" }
            ]
          },
          {
            id: "mini_game",
            type: "mini_game",
            title: "完成一次牌面整理",
            description: "用占位小游戏完成一次整理动作。",
            required: true,
            gameCode: "safe_click",
            requiredResult: "完成一次有效点击"
          }
        ],
        [
          "接龙仪式完成，混乱暂时被四摞牌收容。",
          "你没有拯救世界，但拯救了一小片桌面秩序。"
        ],
        { title: "秩序恢复", copy: "一小局接龙结束，混乱被安静地码好了。" },
        "纸牌秩序"
      ),
      "tiny_challenge"
    ),
    cooldownSeconds: 60 * 60 * 2,
    dailyRewardLimit: 2
  },
  {
    code: "sudoku_row",
    title: "填完数独的一行",
    description: "只填一行，不负责拯救整个九宫格。",
    category: ActivityCategory.game,
    difficulty: ActivityDifficulty.normal,
    rewardConfig: withInteraction(
      { score: 6 },
      guidedInteraction(
        55,
        "external_game",
        [
          {
            id: "row_style",
            type: "choice",
            title: "选择开局行",
            description: "今天准备从哪一行开始？",
            required: true,
            options: [
              { id: "top", label: "第一行", resultText: "从顶部开始，视野开阔。" },
              { id: "middle", label: "中间行", resultText: "从中间切入，风险分散。" },
              { id: "bottom", label: "最底行", resultText: "从底部稳扎稳打。" }
            ]
          },
          {
            id: "mini_game",
            type: "mini_game",
            title: "填入一个数字",
            description: "用占位小游戏完成一次数字选择。",
            required: true,
            gameCode: "word_pick",
            requiredResult: "完成一次数字选择"
          }
        ],
        [
          "一行数独完成，九宫格的命运你负责了 1/9。",
          "理性小闭环达成，剩下的八行假装没看见。"
        ],
        { title: "一行数独完成", copy: "你认真填完了一行，没有拯救全局，但完成了自己的部分。" },
        "一行数独"
      ),
      "tiny_challenge"
    ),
    cooldownSeconds: 60 * 60 * 3,
    dailyRewardLimit: 2
  },
  {
    code: "memory_cards",
    title: "玩一轮翻牌记忆",
    description: "确认短期记忆还没有被会议彻底占满。",
    category: ActivityCategory.game,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: withInteraction(
      { score: 5 },
      guidedInteraction(
        40,
        "external_game",
        [
          {
            id: "memory_mode",
            type: "choice",
            title: "选择记忆策略",
            description: "今天准备靠什么记住位置？",
            required: true,
            options: [
              { id: "color", label: "颜色联想", resultText: "用颜色当钩子，记忆更轻。" },
              { id: "position", label: "位置记忆", resultText: "把位置当成小地图。" },
              { id: "luck", label: "随缘翻牌", resultText: "运气也是短期记忆的一种。" }
            ]
          },
          {
            id: "mini_game",
            type: "mini_game",
            title: "完成一次记忆匹配",
            description: "用占位小游戏模拟一次翻牌匹配。",
            required: true,
            gameCode: "tap_combo",
            requiredResult: "完成 5 次有效点击"
          },
          {
            id: "match_reaction",
            type: "reaction",
            title: "看到匹配信号再点",
            description: "图案闪现时快速点击，允许一次走神。",
            required: true,
            requiredSuccessCount: 2,
            reactionRounds: 3
          }
        ],
        [
          "翻牌完成，短期记忆还有余额。",
          "至少这一局，你的注意力没有被会议全部带走。"
        ],
        { title: "记忆抽检通过", copy: "你完成了一轮翻牌加反应挑战，短期记忆确认还有余额。" },
        "翻牌记忆"
      ),
      "quick"
    ),
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
    rewardConfig: withInteraction(
      { score: 3 },
      guidedInteraction(
        35,
        "none",
        [
          {
            id: "ready",
            type: "ack",
            title: "把水杯放进视野中心",
            description: "如果没有水杯，任意安全杯状物都可以临时上岗。",
            required: true
          },
          {
            id: "stare_timer",
            type: "timer",
            title: "盯住 30 秒",
            description: "观察它，不评价它，也不要顺手打开新消息。",
            required: true,
            durationSeconds: 30
          }
        ],
        [
          "水杯已被充分研究，世界暂时没有变坏。",
          "液体动力学观察结束，你和水杯达成短暂共识。"
        ],
        { title: "水杯研究完成", copy: "你认真盯着水杯 30 秒，没有结论，但杯子感受到了尊重。" },
        "水杯凝视"
      ),
      "recharge"
    ),
    cooldownSeconds: 60 * 30,
    dailyRewardLimit: 3
  },
  {
    code: "window_distance",
    title: "看向远处 60 秒",
    description: "让眼睛临时离开像素，也让灵魂离开需求文档。",
    category: ActivityCategory.rest,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: withInteraction(
      { score: 3 },
      guidedInteraction(
        65,
        "none",
        [
          {
            id: "pick_spot",
            type: "ack",
            title: "找一个远处目标",
            description: "窗外、墙角、走廊尽头都行，重点是离屏幕远一点。",
            required: true
          },
          {
            id: "distance_timer",
            type: "timer",
            title: "看远 60 秒",
            description: "让眼睛从像素井里爬出来，暂时不要分析任何需求。",
            required: true,
            durationSeconds: 60
          }
        ],
        [
          "视线已成功越狱，屏幕暂时失去统治权。",
          "远方接住了你的注意力，像素世界安静了 60 秒。"
        ],
        { title: "眼睛离线成功", copy: "你刚刚把注意力投向远方，灵魂也顺便伸了个懒腰。" },
        "护眼倒计时"
      ),
      "recharge"
    ),
    cooldownSeconds: 60 * 30,
    dailyRewardLimit: 3
  },
  {
    code: "silent_minute",
    title: "安静坐满 1 分钟",
    description: "什么都不解决，也是一种稀缺能力。",
    category: ActivityCategory.rest,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: withInteraction(
      { score: 4 },
      guidedInteraction(
        65,
        "none",
        [
          {
            id: "posture",
            type: "ack",
            title: "找一个舒服的姿势",
            description: "坐着就行，不用盘腿或摆出冥想造型。",
            required: true
          },
          {
            id: "silent_timer",
            type: "timer",
            title: "安静 60 秒",
            description: "不解决、不刷新、不分析，只是安静坐着。",
            required: true,
            durationSeconds: 60
          },
          {
            id: "mood_tag",
            type: "micro-journal",
            title: "标记一下此刻",
            description: "选一个最轻的状态标签，不写小作文。",
            required: false,
            journalMode: "tags",
            tags: [
              { id: "calm", label: "平静", resultText: "平静已记录。" },
              { id: "tired", label: "累", resultText: "累已记录。" },
              { id: "wired", label: "紧绷", resultText: "紧绷已记录。" }
            ],
            minTagCount: 1,
            maxTagCount: 1
          }
        ],
        [
          "一分钟空白完成，世界暂时没有变得更糟。",
          "你什么都没有解决，但给自己留了一分钟。"
        ],
        { title: "一分钟空白完成", copy: "你安静坐满了一分钟，没有产出，但也没有被榨取。" },
        "静音许可"
      ),
      "recharge"
    ),
    cooldownSeconds: 60 * 45,
    dailyRewardLimit: 3
  },
  {
    code: "warm_drink",
    title: "慢慢喝三口水",
    description: "不要一饮而尽，给每一口一点流程感。",
    category: ActivityCategory.rest,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: withInteraction(
      { score: 3 },
      guidedInteraction(
        35,
        "none",
        [
          {
            id: "sip_taps",
            type: "tap-pattern",
            title: "慢慢喝 3 口水",
            description: "每喝一口点一下，给自己一点流程感。",
            required: true,
            requiredTaps: 3,
            tapLabel: "口"
          },
          {
            id: "drink_note",
            type: "micro-journal",
            title: "给这口水一个形容词",
            description: "选一个标签，不用写评测。",
            required: false,
            journalMode: "tags",
            tags: [
              { id: "warm", label: "温热", resultText: "温热已记录。" },
              { id: "cold", label: "清凉", resultText: "清凉已记录。" },
              { id: "bitter", label: "有点苦", resultText: "有点苦已记录。" }
            ],
            minTagCount: 1,
            maxTagCount: 1
          }
        ],
        [
          "三口喝完，每一口都有自己的流程感。",
          "补水仪式完成，身体表示收到。"
        ],
        { title: "三口补给完成", copy: "你慢慢喝了三口水，短暂的流程感也是一种休息。" },
        "三口补给"
      ),
      "recharge"
    ),
    cooldownSeconds: 60 * 30,
    dailyRewardLimit: 4
  },
  {
    code: "close_eyes",
    title: "闭眼点掉 5 个焦虑泡泡",
    description: "不是睡着，只是暂时拒绝接收视觉需求。",
    category: ActivityCategory.rest,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: withInteraction(
      { score: 3 },
      guidedInteraction(
        35,
        "none",
        [
          {
            id: "ack_ready",
            type: "ack",
            title: "准备好闭眼",
            description: "轻轻闭上眼睛，不舒服就随时睁开。",
            required: true
          },
          {
            id: "pop_bubbles",
            type: "tap-pattern",
            title: "点掉 5 个焦虑泡泡",
            description: "每点一下，想象一个念头暂时浮走。",
            required: true,
            requiredTaps: 5,
            tapLabel: "泡泡"
          }
        ],
        [
          "泡泡点完，视觉需求暂时被拒收。",
          "闭眼时间虽短，但足够让屏幕失去一会儿统治权。"
        ],
        { title: "视觉下线成功", copy: "你短暂地拒绝了所有像素，焦虑泡泡也暂时离开了。" },
        "闭眼点击"
      ),
      "quick"
    ),
    cooldownSeconds: 60 * 45,
    dailyRewardLimit: 3
  },
  {
    code: "desk_breathing",
    title: "做 3 轮慢呼吸",
    description: "吸气，呼气，暂时不分析任何根因。",
    category: ActivityCategory.rest,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: withInteraction(
      { score: 4 },
      guidedInteraction(
        55,
        "none",
        [
          {
            id: "breath_mode",
            type: "choice",
            title: "选择呼吸借口",
            description: "给这次离线配一个听起来合理的名义。",
            required: true,
            options: [
              { id: "latency", label: "降低脑延迟", resultText: "脑延迟优化开始。" },
              { id: "cache", label: "清理情绪缓存", resultText: "缓存清理中。" },
              { id: "reboot", label: "温柔重启", resultText: "重启不用关机。" }
            ]
          },
          {
            id: "breath_rounds",
            type: "breath",
            title: "跟着节奏呼吸 3 轮",
            description: "吸气、呼气，不用着急，不顺手点开消息。",
            required: true,
            requiredRounds: 3,
            inhaleSeconds: 4,
            holdSeconds: 2,
            exhaleSeconds: 4
          },
          {
            id: "mood_tag",
            type: "micro-journal",
            title: "标记一下此刻状态",
            description: "选一个最轻的标签，不用写小作文。",
            required: false,
            journalMode: "tags",
            tags: [
              { id: "calm", label: "平静", resultText: "平静已记录。" },
              { id: "tired", label: "累", resultText: "累已记录。" },
              { id: "wired", label: "紧绷", resultText: "紧绷已记录。" }
            ],
            minTagCount: 1,
            maxTagCount: 1
          }
        ],
        [
          "呼吸流程完成，根因分析可以稍后再装作认真。",
          "情绪缓存清理完毕，系统建议先别立刻加载压力。"
        ],
        { title: "呼吸系统上线", copy: "你没有解决世界，但把自己从紧绷里捞回来了一点。" },
        "慢呼吸"
      ),
      "recharge"
    ),
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
    rewardConfig: withInteraction(
      { score: 5 },
      guidedInteraction(
        45,
        "none",
        [
          {
            id: "choose_face",
            type: "choice",
            title: "选择加载中表情",
            description: "要低调，但要让人相信你正在处理一件复杂的事。",
            required: true,
            options: [
              { id: "latency", label: "接口延迟脸", resultText: "像是在等某个响应。" },
              { id: "deep_bug", label: "深层问题脸", resultText: "像是看见了历史包袱。" },
              { id: "budget", label: "预算不足脸", resultText: "像是方案被砍过三轮。" }
            ]
          },
          {
            id: "reaction_hit",
            type: "reaction",
            title: "看到雷达消失再点",
            description: "圆环消失时快速点击，允许一次走神。",
            required: true,
            requiredSuccessCount: 2,
            reactionRounds: 3
          }
        ],
        [
          "加载中表情验收通过，空气认为你很忙。",
          "表情进度条已走完，复杂问题暂时被你的眉头镇住。"
        ],
        { title: "加载表演验收通过", copy: "你完成了一次可撤回的办公室表演，观众主要是空气。" },
        "反应表演"
      ),
      "weird"
    ),
    cooldownSeconds: 60 * 60,
    dailyRewardLimit: 2
  },
  {
    code: "strategic_notebook",
    title: "翻开笔记本沉思 45 秒",
    description: "不用写字，留白本身就是高级方案。",
    category: ActivityCategory.office_theater,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: withInteraction(
      { score: 4 },
      guidedInteraction(
        35,
        "none",
        [
          {
            id: "notebook_pose",
            type: "choice",
            title: "选择沉思姿势",
            description: "这是低风险表演，不需要真的产出方案。",
            required: true,
            options: [
              { id: "blank", label: "盯着空白页", resultText: "留白代表可能性。" },
              { id: "pen", label: "笔尖悬停", resultText: "像是下一秒就要写重点。" },
              { id: "nod", label: "轻轻点头", resultText: "对不存在的方案表示认可。" }
            ]
          },
          {
            id: "perform",
            type: "ack",
            title: "完成 10 秒沉思",
            description: "表情平静，动作轻微，不打扰任何人。",
            required: true
          }
        ],
        [
          "笔记本沉思完成，留白方案通过初审。",
          "空白页没有产出，但它成功承载了你的高级感。"
        ],
        { title: "留白方案已形成", copy: "你没有写下任何字，但气场像是刚做完一次高层对齐。" },
        "办公室表演"
      ),
      "weird"
    ),
    cooldownSeconds: 60 * 60,
    dailyRewardLimit: 2
  },
  {
    code: "calendar_inspection",
    title: "严肃检查一次日历",
    description: "确认今天确实存在，然后放心地合上。",
    category: ActivityCategory.office_theater,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: withInteraction(
      { score: 4 },
      guidedInteraction(
        35,
        "none",
        [
          {
            id: "inspection_style",
            type: "choice",
            title: "选择检查风格",
            description: "严肃地确认今天存在，方式由你决定。",
            required: true,
            options: [
              { id: "nod", label: "点头确认", resultText: "你严肃地点了点头，表示今天存在。" },
              { id: "squint", label: "眯眼审视", resultText: "你眯起眼，像在看一个复杂方案。" },
              { id: "sigh", label: "轻叹合上", resultText: "你轻叹一声，合上了日历。" }
            ]
          },
          {
            id: "today_sign",
            type: "reveal",
            title: "翻开今日签",
            description: "点一下翻开，作为对今天的正式确认。",
            required: true,
            items: [
              { id: "exists", label: "今日存在" },
              { id: "busy", label: "今日较忙" },
              { id: "gap", label: "有缝隙" },
              { id: "leave", label: "允许下班" }
            ]
          }
        ],
        [
          "日历检查完成，今天确实存在，可以稍微放心了。",
          "你已经正式确认过今天，合上日历的动作很有仪式感。"
        ],
        { title: "今日已确认", copy: "你严肃地检查了日历，并郑重确认今天存在。" },
        "日历考古"
      ),
      "weird"
    ),
    cooldownSeconds: 60 * 60,
    dailyRewardLimit: 2
  },
  {
    code: "architecture_stare",
    title: "盯着一张图思考 1 分钟",
    description: "任何图都可以，关键是看起来像在权衡架构。",
    category: ActivityCategory.office_theater,
    difficulty: ActivityDifficulty.normal,
    rewardConfig: withInteraction(
      { score: 5 },
      guidedInteraction(
        55,
        "none",
        [
          {
            id: "diagram_type",
            type: "choice",
            title: "选择图的精神用途",
            description: "看起来像在做复杂判断就行。",
            required: true,
            options: [
              { id: "system", label: "系统边界", resultText: "边界看起来很边界。" },
              { id: "flow", label: "流程流向", resultText: "箭头都很有道理。" },
              { id: "risk", label: "风险收敛", resultText: "风险暂时被凝视压住了。" }
            ]
          },
          {
            id: "stare_timer",
            type: "timer",
            title: "凝视 30 秒",
            description: "眉头微皱，不要真的把自己绕进去。",
            required: true,
            durationSeconds: 30
          },
          {
            id: "priority_sort",
            type: "sort",
            title: "把图中元素按重要性排序",
            description: "拖动条目，排出你心中的架构优先级。",
            required: true,
            items: [
              { id: "core", label: "核心模块" },
              { id: "edge", label: "边界依赖" },
              { id: "noise", label: "噪音需求" },
              { id: "future", label: "未来债务" }
            ]
          }
        ],
        [
          "架构凝视完成，图纸感受到了尊重。",
          "你认真看过了那张图，它现在应该会收敛一点。"
        ],
        { title: "架构权衡结束", copy: "这张图已经被你严肃观察，短期内应该不会反抗。" },
        "架构凝视"
      ),
      "tiny_challenge"
    ),
    cooldownSeconds: 60 * 90,
    dailyRewardLimit: 2
  },
  {
    code: "keyboard_pause",
    title: "双手悬停在键盘上 30 秒",
    description: "像要写出关键代码，实际是在等待灵感上线。",
    category: ActivityCategory.office_theater,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: withInteraction(
      { score: 4 },
      guidedInteraction(
        40,
        "none",
        [
          {
            id: "pause_pose",
            type: "choice",
            title: "选择悬停姿态",
            description: "选一个看起来像深度思考的姿势。",
            required: true,
            options: [
              { id: "fingers", label: "指尖悬停", resultText: "指尖在键帽上方，随时准备起飞。" },
              { id: "chin", label: "单手托腮", resultText: "托腮沉思，显得问题很复杂。" },
              { id: "blank", label: "直视屏幕", resultText: "屏幕里的光标替你承担沉默。" }
            ]
          },
          {
            id: "pause_timer",
            type: "timer",
            title: "悬停 30 秒",
            description: "不要真的敲下去，让灵感假装在加载。",
            required: true,
            durationSeconds: 30
          }
        ],
        [
          "悬停完成，灵感可能没上线，但表演很到位。",
          "30 秒键盘静止，同事可能会以为你在思考大事。"
        ],
        { title: "键盘悬停结束", copy: "你让双手在键盘上空停了 30 秒，表演可信度 +1。" },
        "键盘悬停"
      ),
      "weird"
    ),
    cooldownSeconds: 60 * 60,
    dailyRewardLimit: 2
  },
  {
    code: "document_scroll",
    title: "缓慢滚动一页长文档",
    description: "不要求读懂，滚动速度要体现尊重。",
    category: ActivityCategory.office_theater,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: withInteraction(
      { score: 4 },
      guidedInteraction(
        40,
        "none",
        [
          {
            id: "scroll_ack",
            type: "ack",
            title: "打开一页长文档",
            description: "任意文档即可，关键是动作要像在认真研究。",
            required: true
          },
          {
            id: "priority_sort",
            type: "sort",
            title: "把内容按重要程度排序",
            description: "拖动条目，排成你觉得合理的优先级。",
            required: true,
            items: [
              { id: "deadline", label: "deadline 迫近" },
              { id: "noise", label: "无关通知" },
              { id: "decision", label: "待决策项" },
              { id: "reference", label: "参考资料" }
            ]
          }
        ],
        [
          "文档礼仪完成，你没有真的读完，但尊重到了。",
          "排序结束，长文档获得了它应得的仪式感。"
        ],
        { title: "文档滚动仪式完成", copy: "你缓慢滚动并整理了一份文档的优先级，过程比结果重要。" },
        "文档排序"
      ),
      "weird"
    ),
    cooldownSeconds: 60 * 60,
    dailyRewardLimit: 2
  },

  // Physical
  {
    code: "shoulder_rolls",
    title: "慢慢转动肩膀并呼吸 3 轮",
    description: "动作轻一点，不与工位进行力量对抗。",
    category: ActivityCategory.physical,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: withInteraction(
      { score: 5 },
      guidedInteraction(
        45,
        "none",
        [
          {
            id: "safety",
            type: "ack",
            title: "确认动作舒适",
            description: "如果疼或不舒服，直接换任务，身体优先。",
            required: true
          },
          {
            id: "roll_taps",
            type: "tap-pattern",
            title: "给肩膀 6 次上线信号",
            description: "每点一下，轻轻转一次肩膀，不疼为准。",
            required: true,
            requiredTaps: 6,
            tapLabel: "次转动"
          },
          {
            id: "shoulder_breath",
            type: "breath",
            title: "配合呼吸 3 轮",
            description: "肩膀放松的同时，慢慢吸气呼气。",
            required: true,
            requiredRounds: 3,
            inhaleSeconds: 3,
            holdSeconds: 1,
            exhaleSeconds: 3
          }
        ],
        [
          "肩膀从待机模式回来了，工位气氛稍微松了一点。",
          "肩部完成一次低调上线，没有触发任何会议。"
        ],
        { title: "肩膀重新上线", copy: "你轻轻唤醒了肩膀，还顺手清理了半口紧绷。" },
        "肩颈放松"
      ),
      "recharge"
    ),
    cooldownSeconds: 60 * 45,
    dailyRewardLimit: 3
  },
  {
    code: "desk_stretch",
    title: "站起来伸展 30 秒",
    description: "以舒服为准，不需要证明柔韧性。",
    category: ActivityCategory.physical,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: withInteraction(
      { score: 5 },
      guidedInteraction(
        40,
        "none",
        [
          {
            id: "comfort_check",
            type: "ack",
            title: "确认周围安全",
            description: "站起来前看一下周围，别和椅子或桌角开战。",
            required: true
          },
          {
            id: "stretch_timer",
            type: "timer",
            title: "舒服伸展 30 秒",
            description: "以舒服为准，不要强行表演柔韧性。",
            required: true,
            durationSeconds: 30
          }
        ],
        [
          "伸展完成，椅子短暂失去控制权。",
          "你从工位形态恢复成人类形态，虽然只有半分钟也算。"
        ],
        { title: "身体重新上线", copy: "你从工位形态恢复成人类形态，哪怕只有半分钟。" },
        "身体重启"
      ),
      "recharge"
    ),
    cooldownSeconds: 60 * 45,
    dailyRewardLimit: 3
  },
  {
    code: "short_walk",
    title: "走到门口再回来",
    description: "一次极短的出走，路线安全即可。",
    category: ActivityCategory.physical,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: withInteraction(
      { score: 6, drawProgress: 1 },
      guidedInteraction(
        50,
        "none",
        [
          {
            id: "route",
            type: "choice",
            title: "选择出走路线",
            description: "路线越短越好，安全第一，别把摸鱼整成探险。",
            required: true,
            options: [
              { id: "door", label: "门口往返", resultText: "一次克制的出走。" },
              { id: "water", label: "饮水点往返", resultText: "顺便补水，很像正事。" },
              { id: "window", label: "窗边往返", resultText: "看一眼远方再回来。" }
            ]
          },
          {
            id: "return",
            type: "ack",
            title: "安全返回",
            description: "回来后再点完成，路线不用上传，系统相信你这次。",
            required: true
          }
        ],
        [
          "极短出走结束，身体宣布它还拥有腿。",
          "一次克制的离岗闭环完成，路线短但尊严完整。"
        ],
        { title: "短途出走完成", copy: "你离开了工位，又体面地回来了，像一场微型冒险。" },
        "短途移动"
      ),
      "recharge"
    ),
    cooldownSeconds: 60 * 60,
    dailyRewardLimit: 2
  },
  {
    code: "wrist_release",
    title: "手腕呼吸 3 轮",
    description: "轻轻转动，不疼、不撑、不参加竞技。",
    category: ActivityCategory.physical,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: withInteraction(
      { score: 4 },
      guidedInteraction(
        40,
        "none",
        [
          {
            id: "wrist_ack",
            type: "ack",
            title: "确认手腕舒适",
            description: "如果疼或有旧伤，跳过这一步，身体优先。",
            required: true
          },
          {
            id: "wrist_breath",
            type: "breath",
            title: "边转手腕边呼吸 3 轮",
            description: "动作幅度小一点，呼吸比转动重要。",
            required: true,
            requiredRounds: 3,
            inhaleSeconds: 3,
            holdSeconds: 1,
            exhaleSeconds: 3
          }
        ],
        [
          "手腕完成一次温和释放，没有参加任何比赛。",
          "呼吸和手腕一起下班，键盘暂时失去控制。"
        ],
        { title: "手腕已释放", copy: "你给了手腕一段无绩效的转动时间，它表示感谢。" },
        "手腕呼吸"
      ),
      "recharge"
    ),
    cooldownSeconds: 60 * 30,
    dailyRewardLimit: 4
  },
  {
    code: "stand_and_sit",
    title: "缓慢起立再坐下 3 次",
    description: "量力而行，头晕或不适就直接跳过。",
    category: ActivityCategory.physical,
    difficulty: ActivityDifficulty.normal,
    rewardConfig: withInteraction(
      { score: 6 },
      guidedInteraction(
        45,
        "none",
        [
          {
            id: "safety",
            type: "ack",
            title: "确认身体状态",
            description: "头晕或不适就直接跳过，身体优先。",
            required: true
          },
          {
            id: "sit_stand_taps",
            type: "tap-pattern",
            title: "缓慢起立坐下 3 次",
            description: "每完成一次点一下，动作越慢越算数。",
            required: true,
            requiredTaps: 3,
            tapLabel: "次"
          }
        ],
        [
          "起坐完成，身体短暂证明自己不是椅子插件。",
          "三次起立坐下，你和重力达成了一次小和解。"
        ],
        { title: "起坐协议完成", copy: "你缓慢起立坐下 3 次，身体确认还拥有站立权限。" },
        "起坐协议"
      ),
      "tiny_challenge"
    ),
    cooldownSeconds: 60 * 60,
    dailyRewardLimit: 2
  },
  {
    code: "neck_reset",
    title: "轻轻活动颈部 20 秒",
    description: "只做舒适范围内的小幅动作，不要用力甩动。",
    category: ActivityCategory.physical,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: withInteraction(
      { score: 4 },
      guidedInteraction(
        45,
        "none",
        [
          {
            id: "safety",
            type: "ack",
            title: "确认动作舒适",
            description: "只做小幅动作，疼或晕就跳过。",
            required: true
          },
          {
            id: "neck_timer",
            type: "timer",
            title: "轻轻活动 20 秒",
            description: "缓慢小幅度活动颈部，不用力甩。",
            required: true,
            durationSeconds: 20
          },
          {
            id: "neck_breath",
            type: "breath",
            title: "配合呼吸 2 轮",
            description: "边活动边呼吸，动作比幅度重要。",
            required: true,
            requiredRounds: 2,
            inhaleSeconds: 3,
            holdSeconds: 1,
            exhaleSeconds: 3
          }
        ],
        [
          "颈部重连完成，头和肩膀恢复了基本外交关系。",
          "20 秒活动 + 两轮呼吸，脖子表示可以继续服役。"
        ],
        { title: "颈部重连完成", copy: "你轻轻活动了颈部 20 秒，并配合两轮呼吸，僵硬感稍退。" },
        "颈部重连"
      ),
      "recharge"
    ),
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
    rewardConfig: withInteraction(
      { score: 4 },
      guidedInteraction(
        25,
        "none",
        [
          {
            id: "file_name",
            type: "choice",
            title: "选择文件命名流派",
            description: "不用真的动重要文件，脑内或草稿文件均可。",
            required: true,
            options: [
              { id: "final", label: "final_v2", resultText: "经典永不过时。" },
              { id: "real_final", label: "real_final", resultText: "听起来更接近交付。" },
              { id: "dont_touch", label: "do_not_touch", resultText: "越警告越像重要资产。" }
            ]
          }
        ],
        [
          "命名仪式完成，项目推进感凭空增加。",
          "文件名获得新身份，项目进度条在精神层面动了一下。"
        ],
        { title: "命名仪式完成", copy: "一个名字改变不了项目，但能让你短暂拥有掌控感。" },
        "脑洞选择"
      ),
      "weird"
    ),
    cooldownSeconds: 60 * 60 * 2,
    dailyRewardLimit: 2
  },
  {
    code: "invent_job_title",
    title: "给自己发明一个荒诞职称",
    description: "例如“跨部门空气协调专家”，不用告诉任何人。",
    category: ActivityCategory.imagination,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: withInteraction(
      { score: 5 },
      guidedInteraction(
        25,
        "none",
        [
          {
            id: "title_style",
            type: "choice",
            title: "选择职称风格",
            description: "系统不会真的写进花名册，请放心胡来。",
            required: true,
            options: [
              { id: "air", label: "空气治理系", resultText: "跨部门空气协调专家上线。" },
              { id: "chair", label: "工位生态系", resultText: "人体工学椅外交官上线。" },
              { id: "meeting", label: "会议玄学系", resultText: "议程走向观测员上线。" }
            ]
          },
          {
            id: "title_suffix",
            type: "shuffle-pick",
            title: "抽取职称后缀",
            description: "点一下，领取一个临时后缀，不影响任何职级。",
            required: true,
            items: [
              { id: "senior", label: "高级版" },
              { id: "trainee", label: "见习版" },
              { id: "acting", label: "代理版" },
              { id: "honorary", label: "荣誉版" }
            ]
          }
        ],
        [
          "荒诞职称已生成，你现在拥有一份不会加班的头衔。",
          "新头衔已授予，权限包括短暂开心和拒绝过度严肃。"
        ],
        { title: "荒诞职称授予", copy: "你给自己发明了一个不会加班的职称，权限包括短暂开心。" },
        "头衔制造"
      ),
      "weird"
    ),
    cooldownSeconds: 60 * 60 * 2,
    dailyRewardLimit: 2
  },
  {
    code: "alien_status_report",
    title: "用外星人语气总结今天",
    description: "地球项目仍在运行，碳基员工申请短暂冷却。",
    category: ActivityCategory.imagination,
    difficulty: ActivityDifficulty.normal,
    rewardConfig: withInteraction(
      { score: 6 },
      guidedInteraction(
        50,
        "none",
        [
          {
            id: "alien_tone",
            type: "choice",
            title: "选择外星人视角",
            description: "从哪个星球观察今天的地球项目？",
            required: true,
            options: [
              { id: "observer", label: "中立观测员", resultText: "碳基员工继续运行，无明显异常。" },
              { id: "bored", label: "无聊访客", resultText: "地球项目看起来重复率偏高。" },
              { id: "concerned", label: "担忧邻星", resultText: "建议该星球增加休息补给。" }
            ]
          },
          {
            id: "status_text",
            type: "micro-journal",
            title: "用一句话总结今日地球项目",
            description: "不用真的写成报告，一句话就行。",
            required: true,
            journalMode: "text",
            textMinLength: 5,
            textMaxLength: 50
          }
        ],
        [
          "外星人视角已启用，今天看起来没那么理所当然。",
          "碳基员工总结已提交，宇宙表示收到但不评论。"
        ],
        { title: "地球日报已提交", copy: "你用外星人语气总结了一天，现实暂时失去了它的沉重感。" },
        "地球日报"
      ),
      "weird"
    ),
    cooldownSeconds: 60 * 60 * 3,
    dailyRewardLimit: 1
  },
  {
    code: "name_a_cloud",
    title: "给窗外的一朵云起名字",
    description: "没有云就给一块空白区域命名，流程照常。",
    category: ActivityCategory.imagination,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: withInteraction(
      { score: 4 },
      guidedInteraction(
        30,
        "none",
        [
          {
            id: "cloud_draw",
            type: "shuffle-pick",
            title: "抽一个云的名字",
            description: "云没有意见，名字由你临时颁布。",
            required: true,
            items: [
              { id: "cotton", label: "棉花糖观测员" },
              { id: "wander", label: "流浪水汽" },
              { id: "afternoon", label: "午后缓存云" },
              { id: "unname", label: "拒绝命名云" }
            ]
          }
        ],
        [
          "云名已登记，天空今天多了一份临时身份。",
          "命名完成，那朵云可能永远不会知道这件事。"
        ],
        { title: "云名登记完成", copy: "你给一块空白颁发了临时名字，想象力获得了一小片合法居留权。" },
        "抽云名"
      ),
      "weird"
    ),
    cooldownSeconds: 60 * 60,
    dailyRewardLimit: 2
  },
  {
    code: "tiny_movie_plot",
    title: "编一个 20 秒电影梗概",
    description: "主角必须是一件办公用品，结局可以开放。",
    category: ActivityCategory.imagination,
    difficulty: ActivityDifficulty.normal,
    rewardConfig: withInteraction(
      { score: 6, drawProgress: 1 },
      guidedInteraction(
        35,
        "none",
        [
          {
            id: "hero",
            type: "choice",
            title: "选择主角",
            description: "办公用品也有命运，今天轮到谁上大银幕？",
            required: true,
            options: [
              { id: "stapler", label: "订书机", resultText: "它把破碎的世界订在一起。" },
              { id: "mug", label: "水杯", resultText: "它见证所有无声加班。" },
              { id: "keyboard", label: "键盘", resultText: "它知道太多不该知道的快捷键。" }
            ]
          },
          {
            id: "ending",
            type: "ack",
            title: "给它一个结局",
            description: "开放式、荒诞式、温柔式都行，20 秒内收工。",
            required: true
          }
        ],
        [
          "微型电影杀青，主演办公用品情绪稳定。",
          "办公用品完成主角任务，你完成了一次脑内放映。"
        ],
        { title: "办公大片杀青", copy: "一部不存在的电影完成了，你也完成了一次合法脑洞漂移。" },
        "脑洞编剧"
      ),
      "tiny_reflection"
    ),
    cooldownSeconds: 60 * 60 * 3,
    dailyRewardLimit: 1
  },
  {
    code: "future_message",
    title: "给下班后的自己留一句话",
    description: "可以是鼓励，也可以提醒不要再打开工作软件。",
    category: ActivityCategory.imagination,
    difficulty: ActivityDifficulty.easy,
    rewardConfig: withInteraction(
      { score: 5 },
      guidedInteraction(
        40,
        "none",
        [
          {
            id: "message_type",
            type: "choice",
            title: "选择留言语气",
            description: "给未来的自己留一句不会增加负担的话。",
            required: true,
            options: [
              { id: "kind", label: "温柔提醒", resultText: "未来的你收到一份轻轻的善意。" },
              { id: "firm", label: "坚定下线", resultText: "未来的你被允许别再打开工作软件。" },
              { id: "absurd", label: "荒诞祝福", resultText: "未来的你获得一枚精神护身符。" }
            ]
          },
          {
            id: "message_text",
            type: "micro-journal",
            title: "写一句给下班后的自己",
            description: "短一点，像一张便签。",
            required: true,
            journalMode: "text",
            textMinLength: 3,
            textMaxLength: 40
          },
          {
            id: "today_sign",
            type: "reveal",
            title: "翻开今日摸鱼签",
            description: "点一下翻开，作为这次留言的邮戳。",
            required: true,
            items: [
              { id: "early", label: "准点下班" },
              { id: "water", label: "多喝一口" },
              { id: "window", label: "看云五秒" },
              { id: "mute", label: "消息静音" }
            ]
          }
        ],
        [
          "未来留言已投递，下班后的你可能会点头。",
          "那句话已经发往下班后的你，请记得查收并早点离线。"
        ],
        { title: "未来留言寄出", copy: "你给之后的自己递了一张小纸条，上面写着：别太用力。" },
        "未来留言"
      ),
      "tiny_reflection"
    ),
    cooldownSeconds: 60 * 60 * 2,
    dailyRewardLimit: 2
  }
];

const activityPresentations: Record<string, Prisma.InputJsonObject> = {
  match_three_rounds: {
    badge: "三消避风港",
    tone: "game",
    accentColor: "#6655d8",
    headline: "三关消除，合法换台",
    scene: "把彩色方块排整齐，比把需求排整齐容易一点。",
    prompt: "先选战术，再完成占位小游戏。重点不是赢，是让脑子从工作频道退出来。",
    statLabel: "连击借口",
    statValue: "76%"
  },
  minesweeper_corner: {
    badge: "风险演习",
    tone: "game",
    accentColor: "#6b5bd6",
    headline: "今天先扫虚拟雷",
    scene: "现实风险太贵，虚拟格子刚好适合练胆量。",
    prompt: "选一个扫雷人格，完成安全点击，给风险识别一个体面的出口。",
    statLabel: "避雷体感",
    statValue: "81%"
  },
  word_puzzle: {
    badge: "五格换脑",
    tone: "game",
    accentColor: "#594fc4",
    headline: "猜词，但不负责开会发言",
    scene: "五个字母就够了，今天的大脑不想处理长篇结论。",
    prompt: "选择开局气质，再完成字母选择。猜不猜中不重要，切频道重要。",
    statLabel: "语言复活",
    statValue: "73%"
  },
  solitaire_round: {
    badge: "纸牌秩序",
    tone: "game",
    accentColor: "#7560d8",
    headline: "把混乱排成四摞",
    scene: "有些混乱来自项目，有些混乱可以被纸牌安静收纳。",
    prompt: "打一小轮就好，不追求完美通关，只追求短暂控制感。",
    statLabel: "秩序幻觉",
    statValue: "62%"
  },
  sudoku_row: {
    badge: "九宫格边角料",
    tone: "game",
    accentColor: "#6a58d0",
    headline: "只填一行，不拯救全局",
    scene: "整个数独太严肃，一行刚好适合一场温和撤退。",
    prompt: "找一行填完即可，别把摸鱼变成脑力绩效。",
    statLabel: "理性回声",
    statValue: "69%"
  },
  memory_cards: {
    badge: "记忆抽检",
    tone: "game",
    accentColor: "#7059cf",
    headline: "翻牌一次，证明短期记忆还在",
    scene: "会议可能带走了很多东西，但不一定带走所有记忆。",
    prompt: "玩一轮翻牌记忆，把注意力从工作堆里捡回来。",
    statLabel: "记忆余额",
    statValue: "64%"
  },
  stare_at_water: {
    badge: "水杯研究所",
    tone: "calm",
    accentColor: "#1f8f62",
    headline: "凝视水杯，暂停世界",
    scene: "这只杯子什么都不催，是难得的稳定同事。",
    prompt: "盯住它 30 秒，不分析根因，不刷新消息。",
    statLabel: "液体哲学",
    statValue: "58%"
  },
  window_distance: {
    badge: "远方缓存",
    tone: "calm",
    accentColor: "#287f66",
    headline: "把视线交给远方 60 秒",
    scene: "屏幕占了太多注意力，远处今天也想分一点。",
    prompt: "找一个远处目标看 60 秒，让眼睛从像素里出来透气。",
    statLabel: "视线越狱",
    statValue: "72%"
  },
  silent_minute: {
    badge: "静音许可",
    tone: "calm",
    accentColor: "#2f8060",
    headline: "一分钟不解决任何事",
    scene: "不是所有空白都需要填满，有些空白是给自己留的。",
    prompt: "安静坐满 1 分钟。什么都不推进，也算一种能力。",
    statLabel: "空白浓度",
    statValue: "67%"
  },
  warm_drink: {
    badge: "三口补给",
    tone: "calm",
    accentColor: "#3b8a68",
    headline: "慢慢喝三口水",
    scene: "补水是最不像摸鱼的摸鱼，甚至有点正当。",
    prompt: "给每一口一点流程感，不要像处理工单一样一口清空。",
    statLabel: "补水体面",
    statValue: "61%"
  },
  close_eyes: {
    badge: "视觉下线",
    tone: "calm",
    accentColor: "#2a765f",
    headline: "闭眼 45 秒，拒收像素",
    scene: "眼睛今天已经看了太多界面，它申请临时离线。",
    prompt: "闭眼休息 45 秒，不睡着也没关系，安静就行。",
    statLabel: "暗屏疗效",
    statValue: "70%"
  },
  desk_breathing: {
    badge: "呼吸重启",
    tone: "calm",
    accentColor: "#238b64",
    headline: "五次慢呼吸，清理情绪缓存",
    scene: "空气免费，但经常被我们忘记使用。",
    prompt: "选一个呼吸借口，然后跟着倒计时慢慢吸气呼气。",
    statLabel: "脑延迟下降",
    statValue: "74%"
  },
  fake_loading_face: {
    badge: "加载中演员",
    tone: "absurd",
    accentColor: "#8b4d36",
    headline: "表情进度条缓慢前进",
    scene: "眉头轻皱，像是在等待一个非常重要的响应。",
    prompt: "选择你的加载中表情，维持短短几秒，注意别演过头。",
    statLabel: "表演可信度",
    statValue: "83%"
  },
  strategic_notebook: {
    badge: "留白方案",
    tone: "absurd",
    accentColor: "#94613f",
    headline: "翻开笔记本，沉思但不内耗",
    scene: "空白页不会催你，它只负责让你看起来很有思路。",
    prompt: "选择沉思姿势，完成一次安静、可撤回的办公室表演。",
    statLabel: "高级感",
    statValue: "79%"
  },
  calendar_inspection: {
    badge: "日历考古",
    tone: "absurd",
    accentColor: "#87543a",
    headline: "严肃确认今天确实存在",
    scene: "日历里藏着一些空隙，偶尔也藏着喘气的理由。",
    prompt: "检查一次日历，然后合上。确认世界还在运行即可。",
    statLabel: "时间掌控",
    statValue: "56%"
  },
  architecture_stare: {
    badge: "架构凝视",
    tone: "absurd",
    accentColor: "#78513d",
    headline: "盯着图，假装在权衡宇宙",
    scene: "箭头、框框和线条都很严肃，适合承接你的短暂出神。",
    prompt: "选择图的精神用途，凝视 30 秒，让它感受到尊重。",
    statLabel: "抽象浓度",
    statValue: "88%"
  },
  keyboard_pause: {
    badge: "键盘悬停",
    tone: "absurd",
    accentColor: "#8d5a3d",
    headline: "双手就位，灵感暂未到岗",
    scene: "像要写出关键代码，实际是在等待脑内服务启动。",
    prompt: "悬停 30 秒即可，不需要真的产出让自己痛苦的东西。",
    statLabel: "装忙稳定性",
    statValue: "77%"
  },
  document_scroll: {
    badge: "滚动尊重",
    tone: "absurd",
    accentColor: "#7d4e37",
    headline: "缓慢滚动，保持专业距离",
    scene: "长文档需要尊重，但不一定需要此刻完全读懂。",
    prompt: "慢慢滚动一页，速度要像在认真吸收组织智慧。",
    statLabel: "文档礼仪",
    statValue: "65%"
  },
  shoulder_rolls: {
    badge: "肩部上线",
    tone: "physical",
    accentColor: "#b9821f",
    headline: "肩膀从待机中回来",
    scene: "久坐会把肩膀变成系统托盘图标，现在点一下它。",
    prompt: "先确认舒适，再慢慢转 6 次。疼就换任务。",
    statLabel: "松动幅度",
    statValue: "68%"
  },
  desk_stretch: {
    badge: "人类形态",
    tone: "physical",
    accentColor: "#c08a24",
    headline: "站起来伸展 30 秒",
    scene: "椅子已经连续获胜太久，今天让身体赢一小局。",
    prompt: "确认周围安全，舒服伸展，不和柔韧性较劲。",
    statLabel: "椅子败率",
    statValue: "71%"
  },
  short_walk: {
    badge: "短途出走",
    tone: "physical",
    accentColor: "#b27a1d",
    headline: "离开工位，再体面回来",
    scene: "路线很短，但象征意义很足。",
    prompt: "选一条安全路线，完成门口或饮水点往返。",
    statLabel: "离岗闭环",
    statValue: "86%"
  },
  wrist_release: {
    badge: "手腕解压",
    tone: "physical",
    accentColor: "#bd8422",
    headline: "给手腕一次温和释放",
    scene: "它敲了太多字，值得一段无绩效转动。",
    prompt: "轻轻转动 30 秒，不疼、不撑、不参加任何比赛。",
    statLabel: "按键疲劳",
    statValue: "63%"
  },
  stand_and_sit: {
    badge: "起坐协议",
    tone: "physical",
    accentColor: "#a97520",
    headline: "缓慢起立再坐下 3 次",
    scene: "动作很小，但能提醒身体：你不是椅子的扩展插件。",
    prompt: "量力而行，不舒服就跳过。完成三次即可。",
    statLabel: "插件脱离",
    statValue: "75%"
  },
  neck_reset: {
    badge: "颈部重连",
    tone: "physical",
    accentColor: "#b47d24",
    headline: "轻轻活动颈部 20 秒",
    scene: "脖子不是显示器支架，它也需要一点存在感。",
    prompt: "只做舒适范围内的小幅动作，不用力、不逞强。",
    statLabel: "僵硬下降",
    statValue: "66%"
  },
  rename_temp_file: {
    badge: "命名仪式",
    tone: "daydream",
    accentColor: "#2d7d90",
    headline: "把临时文件升格为 final_v2",
    scene: "项目可能没变，但文件名已经拥有了命运感。",
    prompt: "选择命名流派，完成一场不伤害任何生产文件的仪式。",
    statLabel: "推进幻觉",
    statValue: "82%"
  },
  invent_job_title: {
    badge: "头衔制造",
    tone: "daydream",
    accentColor: "#367f8e",
    headline: "给自己授予荒诞职称",
    scene: "真实职位太严肃，精神职位可以临时自助领取。",
    prompt: "选一个职称风格，获得一份不会加班的头衔。",
    statLabel: "虚职含金量",
    statValue: "78%"
  },
  alien_status_report: {
    badge: "地球日报",
    tone: "daydream",
    accentColor: "#2f758a",
    headline: "用外星人语气总结今天",
    scene: "碳基员工继续运行，地球项目暂无重大突破。",
    prompt: "用陌生视角看今天，现实会显得没那么理所当然。",
    statLabel: "离地高度",
    statValue: "84%"
  },
  name_a_cloud: {
    badge: "云名登记",
    tone: "daydream",
    accentColor: "#3c8796",
    headline: "给远处空白起个名字",
    scene: "有云就命名云，没有云就命名那块不想工作的天空。",
    prompt: "起一个名字即可，越不像 KPI 越好。",
    statLabel: "想象漂移",
    statValue: "60%"
  },
  tiny_movie_plot: {
    badge: "办公短片",
    tone: "daydream",
    accentColor: "#2c7185",
    headline: "20 秒拍完一部脑内电影",
    scene: "办公用品终于有机会成为主角，剧情不必合理。",
    prompt: "选择主角，再给它一个结局。短、怪、轻松就好。",
    statLabel: "片场离谱",
    statValue: "87%"
  },
  future_message: {
    badge: "未来便签",
    tone: "daydream",
    accentColor: "#347f91",
    headline: "给下班后的自己递句话",
    scene: "未来的你也许很累，所以现在先留一点善意过去。",
    prompt: "选择留言语气，写给那个终于可以离线的人。",
    statLabel: "下班护盾",
    statValue: "80%"
  }
};

const activities = rawActivities.map((activity) => ({
  ...activity,
  rewardConfig: withPresentation(
    activity.rewardConfig,
    presentationForActivity(activity.code)
  )
}));

async function main() {
  if (dryRun) {
    const categoryCounts = activities.reduce<Record<string, number>>((counts, activity) => {
      counts[activity.category] = (counts[activity.category] ?? 0) + 1;
      return counts;
    }, {});
    const authoredInteractionCounts = activities.reduce<Record<string, number>>((counts, activity) => {
      if (hasAuthoredInteraction(activity.rewardConfig)) {
        counts[activity.category] = (counts[activity.category] ?? 0) + 1;
      }
      return counts;
    }, {});
    const authoredTotal = Object.values(authoredInteractionCounts).reduce(
      (total, count) => total + count,
      0
    );

    if (activities.length < 30 || Object.values(categoryCounts).some((count) => count < 6)) {
      throw new Error("Activity seed must contain at least 30 templates and 6 per category");
    }
    if (
      authoredTotal < Math.ceil(activities.length / 2) ||
      Object.keys(categoryCounts).some((category) => (authoredInteractionCounts[category] ?? 0) < 3)
    ) {
      throw new Error("Activity seed must provide authored interactions for at least half of templates and 3 per category");
    }
    const missingPresentations = activities
      .filter((activity) => !hasAuthoredPresentation(activity.rewardConfig))
      .map((activity) => activity.code);
    if (missingPresentations.length > 0) {
      throw new Error(`Activity seed missing authored presentation: ${missingPresentations.join(", ")}`);
    }

    for (const activity of activities) {
      validateFlavor(activity.code, activity.rewardConfig);
      if (hasAuthoredInteraction(activity.rewardConfig)) {
        const interaction = (activity.rewardConfig as { interaction?: unknown }).interaction;
        validateAuthoredInteraction(activity.code, interaction);
        validateAuthoredCopy(activity.code, interaction);
      }
    }

    const widgetTemplateCounts = countWidgetTypeTemplates(activities);
    const underusedWidgets = Object.entries(widgetTemplateCounts)
      .filter(([type, count]) => type !== "ack" && (count ?? 0) < 2)
      .map(([type]) => type);
    if (underusedWidgets.length > 0) {
      throw new Error(
        `Activity seed must provide at least 2 templates for each playable widget type. Underused: ${underusedWidgets.join(", ")}`
      );
    }

    const flavorCounts = activities.reduce<Record<string, number>>((counts, activity) => {
      const flavor = (activity.rewardConfig as { flavor?: string }).flavor;
      if (flavor) {
        counts[flavor] = (counts[flavor] ?? 0) + 1;
      }
      return counts;
    }, {});

    console.log(
      JSON.stringify(
        {
          beans: beans.length,
          beanThemes: beans.reduce<Record<string, number>>((counts, bean) => {
            counts[bean.theme] = (counts[bean.theme] ?? 0) + 1;
            return counts;
          }, {}),
          cosmetics: cosmetics.length,
          achievements: achievements.length,
          activities: activities.length,
          activityCategories: categoryCounts,
          authoredInteractionCategories: authoredInteractionCounts,
          authoredInteractions: authoredTotal,
          authoredPresentations: activities.length,
          widgetTemplateCounts,
          flavorCounts
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

function hasAuthoredInteraction(value: unknown) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as { interaction?: unknown }).interaction
  );
}

function hasAuthoredPresentation(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const presentation = (value as { presentation?: unknown }).presentation;
  return Boolean(
    presentation &&
      typeof presentation === "object" &&
      !Array.isArray(presentation) &&
      typeof (presentation as { badge?: unknown }).badge === "string" &&
      typeof (presentation as { headline?: unknown }).headline === "string" &&
      typeof (presentation as { scene?: unknown }).scene === "string" &&
      typeof (presentation as { prompt?: unknown }).prompt === "string" &&
      typeof (presentation as { statLabel?: unknown }).statLabel === "string" &&
      typeof (presentation as { statValue?: unknown }).statValue === "string"
  );
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
