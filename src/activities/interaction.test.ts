import { describe, expect, it } from "vitest";
import {
  buildActivityInteraction,
  summarizeCompletedSteps,
  validateActivityInteractionProgress
} from "./interaction.js";

describe("activity interaction validation", () => {
  it("requires ack steps to be marked complete", () => {
    const interaction = buildInteraction([
      { id: "ack", type: "ack", title: "确认", description: "确认一下", required: true }
    ]);
    expect(validateActivityInteractionProgress(interaction, {}).ok).toBe(false);
    expect(
      validateActivityInteractionProgress(interaction, { completedStepIds: ["ack"] }).ok
    ).toBe(true);
  });

  it("requires timer steps to reach configured duration", () => {
    const interaction = buildInteraction([
      { id: "timer", type: "timer", title: "等", description: "等一下", required: true, durationSeconds: 10 }
    ]);
    expect(
      validateActivityInteractionProgress(interaction, { timerSeconds: { timer: 9 } }).ok
    ).toBe(false);
    expect(
      validateActivityInteractionProgress(interaction, { timerSeconds: { timer: 10 } }).ok
    ).toBe(true);
  });

  it("requires choice answers and honors correctOptionId", () => {
    const openChoiceInteraction = buildInteraction([
      {
        id: "choice",
        type: "choice",
        title: "选",
        description: "选一个",
        required: true,
        options: [
          { id: "a", label: "A", resultText: "a" },
          { id: "b", label: "B", resultText: "b" }
        ]
      }
    ]);
    expect(
      validateActivityInteractionProgress(openChoiceInteraction, { choiceAnswers: { choice: "unknown" } }).ok
    ).toBe(false);
    expect(
      validateActivityInteractionProgress(openChoiceInteraction, { choiceAnswers: { choice: "a" } }).ok
    ).toBe(true);

    const interaction = buildInteraction([
      {
        id: "choice",
        type: "choice",
        title: "选",
        description: "选一个",
        required: true,
        options: [
          { id: "a", label: "A", resultText: "a" },
          { id: "b", label: "B", resultText: "b" }
        ],
        correctOptionId: "b"
      }
    ]);
    expect(
      validateActivityInteractionProgress(interaction, { choiceAnswers: { choice: "a" } }).ok
    ).toBe(false);
    expect(
      validateActivityInteractionProgress(interaction, { choiceAnswers: { choice: "b" } }).ok
    ).toBe(true);
  });

  it("requires mini-game results to pass", () => {
    const interaction = buildInteraction([
      { id: "game", type: "mini_game", title: "玩", description: "玩一下", required: true }
    ]);
    expect(
      validateActivityInteractionProgress(interaction, { miniGameResults: { game: { passed: false } } }).ok
    ).toBe(false);
    expect(
      validateActivityInteractionProgress(interaction, { miniGameResults: { game: { passed: true } } }).ok
    ).toBe(true);
  });

  it("validates tap-pattern by required taps", () => {
    const interaction = buildInteraction([
      { id: "tap", type: "tap-pattern", title: "点", description: "点泡泡", required: true, requiredTaps: 5 }
    ]);
    expect(
      validateActivityInteractionProgress(interaction, { tapCounts: { tap: 4 } }).ok
    ).toBe(false);
    expect(
      validateActivityInteractionProgress(interaction, { tapCounts: { tap: 5 } }).ok
    ).toBe(true);
  });

  it("validates shuffle-pick by selected item id", () => {
    const interaction = buildInteraction([
      {
        id: "pick",
        type: "shuffle-pick",
        title: "抽",
        description: "抽一张",
        required: true,
        items: [
          { id: "a", label: "A" },
          { id: "b", label: "B" }
        ]
      }
    ]);
    expect(
      validateActivityInteractionProgress(interaction, { selectedOptions: { pick: "c" } }).ok
    ).toBe(false);
    expect(
      validateActivityInteractionProgress(interaction, { selectedOptions: { pick: "b" } }).ok
    ).toBe(true);
  });

  it("validates sort by complete ordering and optional correct order", () => {
    const items = [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }];
    const interactionAnyOrder = buildInteraction([
      { id: "sort", type: "sort", title: "排", description: "排序", required: true, items }
    ]);
    expect(
      validateActivityInteractionProgress(interactionAnyOrder, { sortedItemIds: { sort: ["a", "b"] } }).ok
    ).toBe(false);
    expect(
      validateActivityInteractionProgress(interactionAnyOrder, { sortedItemIds: { sort: ["c", "a", "b"] } }).ok
    ).toBe(true);

    const interactionExactOrder = buildInteraction([
      {
        id: "sort",
        type: "sort",
        title: "排",
        description: "按正确顺序排",
        required: true,
        items,
        correctOrder: ["a", "b", "c"]
      }
    ]);
    expect(
      validateActivityInteractionProgress(interactionExactOrder, { sortedItemIds: { sort: ["c", "a", "b"] } }).ok
    ).toBe(false);
    expect(
      validateActivityInteractionProgress(interactionExactOrder, { sortedItemIds: { sort: ["a", "b", "c"] } }).ok
    ).toBe(true);
  });

  it("validates breath by completed rounds", () => {
    const interaction = buildInteraction([
      { id: "breath", type: "breath", title: "呼吸", description: "呼吸", required: true, requiredRounds: 3 }
    ]);
    expect(
      validateActivityInteractionProgress(interaction, { breathRounds: { breath: 2 } }).ok
    ).toBe(false);
    expect(
      validateActivityInteractionProgress(interaction, { breathRounds: { breath: 3 } }).ok
    ).toBe(true);
  });

  it("validates reaction by success count", () => {
    const interaction = buildInteraction([
      {
        id: "react",
        type: "reaction",
        title: "反应",
        description: "反应",
        required: true,
        requiredSuccessCount: 2
      }
    ]);
    expect(
      validateActivityInteractionProgress(interaction, { reactionResults: { react: { successCount: 1, attempts: 3 } } }).ok
    ).toBe(false);
    expect(
      validateActivityInteractionProgress(interaction, { reactionResults: { react: { successCount: 2, attempts: 3 } } }).ok
    ).toBe(true);
  });

  it("validates micro-journal text length and tag constraints", () => {
    const interaction = buildInteraction([
      {
        id: "journal",
        type: "micro-journal",
        title: "记录",
        description: "写一句",
        required: true,
        journalMode: "text",
        textMinLength: 3,
        textMaxLength: 50
      }
    ]);
    expect(
      validateActivityInteractionProgress(interaction, { journalEntries: { journal: { text: "hi" } } }).ok
    ).toBe(false);
    expect(
      validateActivityInteractionProgress(interaction, { journalEntries: { journal: { text: "hello world" } } }).ok
    ).toBe(true);

    const tagInteraction = buildInteraction([
      {
        id: "journal",
        type: "micro-journal",
        title: "记录",
        description: "选标签",
        required: true,
        journalMode: "tags",
        tags: [
          { id: "calm", label: "平静", resultText: "" },
          { id: "tired", label: "累", resultText: "" }
        ],
        minTagCount: 1,
        maxTagCount: 2
      }
    ]);
    expect(
      validateActivityInteractionProgress(tagInteraction, { journalEntries: { journal: { tagIds: ["unknown"] } } }).ok
    ).toBe(false);
    expect(
      validateActivityInteractionProgress(tagInteraction, { journalEntries: { journal: { tagIds: ["calm"] } } }).ok
    ).toBe(true);
  });

  it("validates reveal by selected item id", () => {
    const interaction = buildInteraction([
      {
        id: "reveal",
        type: "reveal",
        title: "翻",
        description: "翻一张",
        required: true,
        items: [{ id: "x", label: "X" }]
      }
    ]);
    expect(
      validateActivityInteractionProgress(interaction, { selectedOptions: { reveal: "y" } }).ok
    ).toBe(false);
    expect(
      validateActivityInteractionProgress(interaction, { selectedOptions: { reveal: "x" } }).ok
    ).toBe(true);
  });

  it("allows optional steps to remain incomplete", () => {
    const interaction = buildInteraction([
      { id: "required", type: "ack", title: "必须", description: "必须做", required: true },
      { id: "optional", type: "ack", title: "可选", description: "可选做", required: false }
    ]);
    expect(
      validateActivityInteractionProgress(interaction, { completedStepIds: ["required"] }).ok
    ).toBe(true);
  });

  it("reports missing step ids when validation fails", () => {
    const interaction = buildInteraction([
      { id: "a", type: "ack", title: "A", description: "a", required: true },
      { id: "b", type: "ack", title: "B", description: "b", required: true }
    ]);
    const result = validateActivityInteractionProgress(interaction, { completedStepIds: ["a"] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missingStepIds).toEqual(["b"]);
    }
  });

  it("keeps existing category defaults working without authored interaction", () => {
    const template = {
      code: "default_rest",
      title: "默认休息",
      description: "休息一下",
      category: "rest" as const,
      difficulty: "easy" as const,
      rewardConfig: { score: 3 }
    };
    const interaction = buildActivityInteraction(template);
    expect(interaction.steps.length).toBeGreaterThan(0);
    expect(interaction.steps.some((step) => step.type === "timer" || step.type === "ack")).toBe(true);
  });

  it("summarizes completed widget steps without judging performance", () => {
    const interaction = buildInteraction([
      {
        id: "choice",
        type: "choice",
        title: "选",
        description: "选一个",
        required: true,
        options: [
          { id: "a", label: "A", resultText: "a" },
          { id: "b", label: "B", resultText: "b" }
        ]
      },
      {
        id: "tap",
        type: "tap-pattern",
        title: "点",
        description: "点泡泡",
        required: true,
        requiredTaps: 5
      },
      {
        id: "breath",
        type: "breath",
        title: "呼吸",
        description: "呼吸",
        required: true,
        requiredRounds: 3
      }
    ]);
    const progress = {
      choiceAnswers: { choice: "a" },
      tapCounts: { tap: 5 },
      breathRounds: { breath: 3 }
    };
    const lines = summarizeCompletedSteps(interaction, progress);
    expect(lines).toContain("选择了「A」");
    expect(lines).toContain("点击 5 次");
    expect(lines).toContain("完成 3 轮呼吸");
    expect(lines.every((line) => !line.includes("优秀") && !line.includes("评分"))).toBe(true);
  });
});

function buildInteraction(steps: unknown[]) {
  return {
    mode: "guided" as const,
    estimatedSeconds: 30,
    proofPolicy: "none" as const,
    flavorLabel: "测试",
    steps: steps as never[],
    completionFeedback: ["完成"],
    resultSummary: { title: "完成", copy: "测试完成" }
  };
}
