import type { ProgressionPeriodType } from "@prisma/client";

export type ProgressionGoalCode =
  | "check_in"
  | "activity"
  | "bean_draw"
  | "rest_minutes"
  | "active_days";

export type ProgressionGoal = {
  code: ProgressionGoalCode;
  title: string;
  description: string;
  current: number;
  target: number;
  unit: "times" | "minutes" | "days";
  completed: boolean;
};

export type GoalPeriodReward = {
  score: number;
  drawProgress: number;
};

export const goalPeriodRewards: Record<ProgressionPeriodType, GoalPeriodReward> = {
  daily: { score: 15, drawProgress: 1 },
  weekly: { score: 50, drawProgress: 2 }
};

export function utcWeekRange(now: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = start.getUTCDay();
  start.setUTCDate(start.getUTCDate() - (day === 0 ? 6 : day - 1));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return { start, end };
}

export function createDailyGoals(input: {
  checkIns: number;
  activities: number;
  beanDraws: number;
}): ProgressionGoal[] {
  return [
    goal("check_in", "完成一次有效打卡", "休息至少 1 分钟并完成结算", input.checkIns, 1, "times"),
    goal("activity", "完成一个摸鱼任务", "领取并完成一个摸鱼活动", input.activities, 1, "times"),
    goal("bean_draw", "抽取一颗工位命运豆", "攒满机会后抽取一颗收藏豆", input.beanDraws, 1, "times")
  ];
}

export function createWeeklyGoals(input: {
  restMinutes: number;
  activities: number;
  activeDays: number;
}): ProgressionGoal[] {
  return [
    goal("rest_minutes", "本周认真休息 60 分钟", "只统计有效打卡时长", input.restMinutes, 60, "minutes"),
    goal("activity", "本周完成 5 个摸鱼任务", "不同分类都可以，按自己的节奏来", input.activities, 5, "times"),
    goal("active_days", "本周有 3 天记得休息", "每天完成一次有效打卡即可", input.activeDays, 3, "days")
  ];
}

function goal(
  code: ProgressionGoalCode,
  title: string,
  description: string,
  current: number,
  target: number,
  unit: ProgressionGoal["unit"]
): ProgressionGoal {
  return {
    code,
    title,
    description,
    current,
    target,
    unit,
    completed: current >= target
  };
}
