import type {
  ActivityCategory,
  ActivityTemplate,
  Prisma
} from "@prisma/client";
import { normalizeActivityCategory } from "./recommendation.js";

export type ActivityInteractionStepType = "ack" | "timer" | "choice" | "mini_game";
export type ActivityProofPolicy = "none" | "optional_photo" | "optional_location" | "external_game";

export type ActivityInteractionStep = {
  id: string;
  type: ActivityInteractionStepType;
  title: string;
  description: string;
  required: boolean;
  durationSeconds?: number;
  options?: Array<{ id: string; label: string; resultText: string }>;
  correctOptionId?: string;
  gameCode?: string;
  requiredResult?: string;
};

export type ActivityInteraction = {
  mode: "guided";
  estimatedSeconds: number;
  proofPolicy: ActivityProofPolicy;
  flavorLabel: string;
  steps: ActivityInteractionStep[];
  completionFeedback: string[];
  resultSummary: {
    title: string;
    copy: string;
  };
};

export type ActivityInteractionSummary = {
  stepCount: number;
  estimatedSeconds: number;
  hasTimer: boolean;
  hasChoice: boolean;
  hasMiniGame: boolean;
  proofPolicy: ActivityProofPolicy;
  flavorLabel: string;
};

export type ActivityPresentationTone =
  | "absurd"
  | "calm"
  | "game"
  | "physical"
  | "daydream";

export type ActivityPresentation = {
  badge: string;
  tone: ActivityPresentationTone;
  accentColor: string;
  headline: string;
  scene: string;
  prompt: string;
  statLabel: string;
  statValue: string;
};

export type ActivityInteractionProgress = {
  completedStepIds?: string[];
  timerSeconds?: Record<string, number>;
  choiceAnswers?: Record<string, string>;
  miniGameResults?: Record<string, { passed?: boolean; score?: number }>;
};

export function buildActivityInteraction(template: Pick<
  ActivityTemplate,
  "code" | "title" | "description" | "category" | "difficulty" | "rewardConfig"
>): ActivityInteraction {
  const configured = readConfiguredInteraction(template.rewardConfig);
  if (configured) {
    return configured;
  }

  const category = normalizeActivityCategory(template.category);
  const warmup: ActivityInteractionStep = {
    id: "notice",
    type: "ack",
    title: "先确认你真的要摸一下",
    description: "别急着领奖。先看完任务，决定要认真做这一次。",
    required: true
  };

  if (category === "game") {
    return interaction(75, "external_game", [
      warmup,
      {
        id: "mini_game",
        type: "mini_game",
        title: "完成一个轻量小游戏",
        description: "当前先用内置小游戏占位，后续可以接独立小游戏工程。",
        required: true,
        gameCode: gameCodeFor(template.code),
        requiredResult: "达到通关条件"
      }
    ], [
      "游戏通关，脑子完成了一次合法换台。",
      "你不是在玩，你是在维护手眼协调。"
    ]);
  }

  if (category === "rest" || category === "physical") {
    const seconds = category === "physical" ? 20 : 15;
    return interaction(seconds + 15, "none", [
      warmup,
      {
        id: "timer",
        type: "timer",
        title: category === "physical" ? "动一动，别让椅子赢太久" : "安静离线一小会儿",
        description: category === "physical"
          ? "跟着倒计时完成一个低调动作，别给自己整成团建。"
          : "倒计时结束前先别点完成，给大脑一点空白。",
        required: true,
        durationSeconds: seconds
      }
    ], [
      "这次休息有过程，不是纯点按钮糊弄。",
      "很好，你刚刚短暂地从工位系统里解绑了。"
    ]);
  }

  if (category === "imagination") {
    return interaction(30, "none", [
      warmup,
      {
        id: "choice",
        type: "choice",
        title: "选一个今日摸鱼理由",
        description: "没有标准答案，但选择本身就是一种短暂自由。",
        required: true,
        options: [
          { id: "brain_cache", label: "清理脑内缓存", resultText: "缓存已清，灵魂重启中。" },
          { id: "chair_sync", label: "和椅子同步状态", resultText: "同步成功，椅子表示理解。" },
          { id: "future_self", label: "给未来的自己留余地", resultText: "未来的你发来感谢。" }
        ]
      }
    ], [
      "理由生成成功，这一刻你拥有合理离线权。",
      "脑洞完成，现实暂时没有追上你。"
    ]);
  }

  return interaction(25, "none", [
    warmup,
    {
      id: "performance",
      type: "ack",
      title: "完成一次低风险办公室表演",
      description: "比如认真点头、研究杯子、凝视白板。不要打扰别人。",
      required: true
    }
  ], [
    "表演结束，观众可能只有空气，但空气很买账。",
    "你完成了一次不会写进绩效的精彩演出。"
  ]);
}

export function summarizeActivityInteraction(
  interaction: ActivityInteraction
): ActivityInteractionSummary {
  return {
    stepCount: interaction.steps.length,
    estimatedSeconds: interaction.estimatedSeconds,
    hasTimer: interaction.steps.some((step) => step.type === "timer"),
    hasChoice: interaction.steps.some((step) => step.type === "choice"),
    hasMiniGame: interaction.steps.some((step) => step.type === "mini_game"),
    proofPolicy: interaction.proofPolicy,
    flavorLabel: interaction.flavorLabel
  };
}

export function buildActivityPresentation(template: Pick<
  ActivityTemplate,
  "code" | "title" | "description" | "category" | "difficulty" | "rewardConfig"
>): ActivityPresentation {
  const category = normalizeActivityCategory(template.category);
  const defaults = defaultActivityPresentation({
    code: template.code,
    title: template.title,
    description: template.description,
    category,
    difficulty: template.difficulty
  });
  const configured = readConfiguredPresentation(template.rewardConfig);
  return {
    ...defaults,
    ...configured,
    headline: configured?.headline?.trim() || defaults.headline,
    scene: configured?.scene?.trim() || defaults.scene,
    prompt: configured?.prompt?.trim() || defaults.prompt,
    badge: configured?.badge?.trim() || defaults.badge,
    statLabel: configured?.statLabel?.trim() || defaults.statLabel,
    statValue: configured?.statValue?.trim() || defaults.statValue
  };
}

export function validateActivityInteractionProgress(
  interaction: ActivityInteraction,
  progress: ActivityInteractionProgress | undefined
): { ok: true } | { ok: false; missingStepIds: string[] } {
  const missingStepIds = interaction.steps
    .filter((step) => step.required)
    .filter((step) => !isStepComplete(step, progress))
    .map((step) => step.id);

  return missingStepIds.length === 0 ? { ok: true } : { ok: false, missingStepIds };
}

export function pickCompletionFeedback(interaction: ActivityInteraction, seed: string): string {
  const options = interaction.completionFeedback.length
    ? interaction.completionFeedback
    : ["任务完成，奖励已结算。"];
  const hash = [...seed].reduce((total, char) => total + char.charCodeAt(0), 0);
  return options[hash % options.length];
}

function interaction(
  estimatedSeconds: number,
  proofPolicy: ActivityProofPolicy,
  steps: ActivityInteractionStep[],
  completionFeedback: string[],
  resultSummary?: ActivityInteraction["resultSummary"],
  flavorLabel?: string
): ActivityInteraction {
  return {
    mode: "guided",
    estimatedSeconds,
    proofPolicy,
    flavorLabel: flavorLabel ?? defaultFlavorLabel(steps),
    steps,
    completionFeedback,
    resultSummary: resultSummary ?? {
      title: "摸鱼任务完成",
      copy: "这次短暂离线已被系统记录，奖励也安排上了。"
    }
  };
}

function isStepComplete(
  step: ActivityInteractionStep,
  progress: ActivityInteractionProgress | undefined
): boolean {
  if (step.type === "ack") {
    return Boolean(progress?.completedStepIds?.includes(step.id));
  }

  if (step.type === "timer") {
    return (progress?.timerSeconds?.[step.id] ?? 0) >= (step.durationSeconds ?? 0);
  }

  if (step.type === "choice") {
    const answer = progress?.choiceAnswers?.[step.id];
    if (!answer) return false;
    return step.correctOptionId ? answer === step.correctOptionId : true;
  }

  if (step.type === "mini_game") {
    return progress?.miniGameResults?.[step.id]?.passed === true;
  }

  return false;
}

function gameCodeFor(templateCode: string): string {
  if (templateCode.includes("match")) return "tap_combo";
  if (templateCode.includes("word")) return "word_pick";
  if (templateCode.includes("mine")) return "safe_click";
  return "reaction_tap";
}

function readConfiguredInteraction(value: Prisma.JsonValue): ActivityInteraction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const maybe = (value as { interaction?: unknown }).interaction;
  if (!maybe || typeof maybe !== "object" || Array.isArray(maybe)) {
    return null;
  }
  const interaction = maybe as Partial<ActivityInteraction>;
  if (interaction.mode !== "guided" || !Array.isArray(interaction.steps)) {
    return null;
  }
  return {
    mode: "guided",
    estimatedSeconds: Number(interaction.estimatedSeconds ?? 30),
    proofPolicy: interaction.proofPolicy ?? "none",
    flavorLabel: typeof interaction.flavorLabel === "string"
      ? interaction.flavorLabel
      : defaultFlavorLabel(interaction.steps),
    steps: interaction.steps,
    completionFeedback: Array.isArray(interaction.completionFeedback)
      ? interaction.completionFeedback
      : [],
    resultSummary: isResultSummary(interaction.resultSummary)
      ? interaction.resultSummary
      : {
          title: "摸鱼任务完成",
          copy: "这次短暂离线已被系统记录，奖励也安排上了。"
        }
  };
}

function readConfiguredPresentation(value: Prisma.JsonValue): Partial<ActivityPresentation> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const maybe = (value as { presentation?: unknown }).presentation;
  if (!maybe || typeof maybe !== "object" || Array.isArray(maybe)) {
    return null;
  }
  const presentation = maybe as Partial<ActivityPresentation>;
  const tone = isPresentationTone(presentation.tone) ? presentation.tone : undefined;
  return {
    badge: typeof presentation.badge === "string" ? presentation.badge : undefined,
    tone,
    accentColor: typeof presentation.accentColor === "string"
      ? presentation.accentColor
      : undefined,
    headline: typeof presentation.headline === "string" ? presentation.headline : undefined,
    scene: typeof presentation.scene === "string" ? presentation.scene : undefined,
    prompt: typeof presentation.prompt === "string" ? presentation.prompt : undefined,
    statLabel: typeof presentation.statLabel === "string" ? presentation.statLabel : undefined,
    statValue: typeof presentation.statValue === "string" ? presentation.statValue : undefined
  };
}

function defaultActivityPresentation(input: {
  code: string;
  title: string;
  description: string;
  category: ReturnType<typeof normalizeActivityCategory>;
  difficulty: ActivityTemplate["difficulty"];
}): ActivityPresentation {
  const statValue = playfulStatValue(input.code, input.difficulty);
  if (input.category === "game") {
    return {
      badge: "小游戏入口",
      tone: "game",
      accentColor: "#6655d8",
      headline: input.title,
      scene: "屏幕前的短暂叛逃，手指负责把大脑带离工位。",
      prompt: input.description,
      statLabel: "手眼协调",
      statValue
    };
  }

  if (input.category === "rest") {
    return {
      badge: "精神离线",
      tone: "calm",
      accentColor: "#1f8f62",
      headline: input.title,
      scene: "把注意力从消息红点里拽出来，给自己留一小块静音区。",
      prompt: input.description,
      statLabel: "回血概率",
      statValue
    };
  }

  if (input.category === "physical") {
    return {
      badge: "身体重启",
      tone: "physical",
      accentColor: "#b9821f",
      headline: input.title,
      scene: "椅子已经连续获胜太久，现在轮到身体拿回一点控制权。",
      prompt: input.description,
      statLabel: "关节上线",
      statValue
    };
  }

  if (input.category === "imagination") {
    return {
      badge: "脑洞逃逸",
      tone: "daydream",
      accentColor: "#2d7d90",
      headline: input.title,
      scene: "现实先放旁边，给脑内小剧场批准一张临时通行证。",
      prompt: input.description,
      statLabel: "离谱指数",
      statValue
    };
  }

  return {
    badge: "工位表演",
    tone: "absurd",
    accentColor: "#8b4d36",
    headline: input.title,
    scene: "这是一场不需要观众的办公室独幕剧，表演结束就能继续装忙。",
    prompt: input.description,
    statLabel: "戏剧张力",
    statValue
  };
}

function playfulStatValue(code: string, difficulty: ActivityTemplate["difficulty"]): string {
  const base = difficulty === "hard" ? 70 : difficulty === "normal" ? 55 : 40;
  const hash = [...code].reduce((total, char) => total + char.charCodeAt(0), 0);
  return `${Math.min(96, base + (hash % 22))}%`;
}

function isPresentationTone(value: unknown): value is ActivityPresentationTone {
  return value === "absurd" ||
    value === "calm" ||
    value === "game" ||
    value === "physical" ||
    value === "daydream";
}

function defaultFlavorLabel(steps: ActivityInteractionStep[]): string {
  if (steps.some((step) => step.type === "mini_game")) return "小游戏";
  if (steps.some((step) => step.type === "timer")) return "倒计时";
  if (steps.some((step) => step.type === "choice")) return "选择题";
  return "轻确认";
}

function isResultSummary(value: unknown): value is ActivityInteraction["resultSummary"] {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (value as { title?: unknown }).title === "string" &&
      typeof (value as { copy?: unknown }).copy === "string"
  );
}
