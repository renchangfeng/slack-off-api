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

function withInteraction(
  rewardConfig: Prisma.InputJsonObject,
  interaction: Prisma.InputJsonObject
) {
  return {
    ...rewardConfig,
    interaction
  };
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

const activities = [
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
        ["消消乐训练结束，大脑成功假装换了一块显卡。"]
      )
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
        ["扫雷训练结束，风险识别能力获得精神认证。"],
        { title: "风险识别完成", copy: "你刚刚严肃地处理了一块虚拟雷区，现实问题先排队。" },
        "风险小游戏"
      )
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
        ["五格脑力活动完成，语言中枢短暂复活。"],
        { title: "单词频道切换成功", copy: "工作脑暂时退后台，猜词脑上来透了口气。" },
        "字谜小游戏"
      )
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
        ["水杯已被充分研究，世界暂时没有变坏。"]
      )
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
        ["视线已成功越狱，屏幕暂时失去统治权。"],
        { title: "眼睛离线成功", copy: "你刚刚把注意力投向远方，灵魂也顺便伸了个懒腰。" },
        "护眼倒计时"
      )
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
    rewardConfig: withInteraction(
      { score: 4 },
      guidedInteraction(
        45,
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
            id: "breath_timer",
            type: "timer",
            title: "慢呼吸 30 秒",
            description: "吸气，呼气，不顺手点开消息。",
            required: true,
            durationSeconds: 30
          }
        ],
        ["呼吸流程完成，根因分析可以稍后再装作认真。"],
        { title: "呼吸系统上线", copy: "你没有解决世界，但把自己从紧绷里捞回来了一点。" },
        "慢呼吸"
      )
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
            id: "performance",
            type: "ack",
            title: "维持 10 秒",
            description: "不要过火，办公室表演的核心是可撤回。",
            required: true
          }
        ],
        ["加载中表情验收通过，空气认为你很忙。"]
      )
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
        ["笔记本沉思完成，留白方案通过初审。"],
        { title: "留白方案已形成", copy: "你没有写下任何字，但气场像是刚做完一次高层对齐。" },
        "办公室表演"
      )
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
          }
        ],
        ["架构凝视完成，图纸感受到了尊重。"],
        { title: "架构权衡结束", copy: "这张图已经被你严肃观察，短期内应该不会反抗。" },
        "架构凝视"
      )
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
    rewardConfig: withInteraction(
      { score: 5 },
      guidedInteraction(
        30,
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
            id: "roll_timer",
            type: "timer",
            title: "跟着节奏转 6 次",
            description: "慢慢来，肩膀不是 KPI，不用冲刺。",
            required: true,
            durationSeconds: 20
          }
        ],
        ["肩膀从待机模式回来了，工位气氛稍微松了一点。"]
      )
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
        ["伸展完成，椅子短暂失去控制权。"],
        { title: "身体重新上线", copy: "你从工位形态恢复成人类形态，哪怕只有半分钟。" },
        "身体重启"
      )
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
        "optional_location",
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
        ["极短出走结束，身体宣布它还拥有腿。"],
        { title: "短途出走完成", copy: "你离开了工位，又体面地回来了，像一场微型冒险。" },
        "短途移动"
      )
    ),
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
        ["命名仪式完成，项目推进感凭空增加。"],
        { title: "命名仪式完成", copy: "一个名字改变不了项目，但能让你短暂拥有掌控感。" },
        "脑洞选择"
      )
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
          }
        ],
        ["荒诞职称已生成，你现在拥有一份不会加班的头衔。"]
      )
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
        ["微型电影杀青，主演办公用品情绪稳定。"],
        { title: "办公大片杀青", copy: "一部不存在的电影完成了，你也完成了一次合法脑洞漂移。" },
        "脑洞编剧"
      )
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
        25,
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
          }
        ],
        ["未来留言已投递，下班后的你可能会点头。"],
        { title: "未来留言寄出", copy: "你给之后的自己递了一张小纸条，上面写着：别太用力。" },
        "未来留言"
      )
    ),
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
          authoredInteractions: authoredTotal
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

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
