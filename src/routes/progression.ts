import {
  ActivityAssignmentStatus,
  LeaderboardWindow,
  ProgressionPeriodType,
  RewardSourceType,
  RewardType,
  type Prisma
} from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { recordAuditEventWithClient } from "../audit/events.js";
import {
  buildExistingLoopAuditMetadata,
  grantExistingLoopRewards,
  reconstructExistingLoopOutcomes,
  resolveExistingLoopOutcomes,
  type ExistingRewardSourceType
} from "../fish-tank/resources.js";
import { fail, ok } from "../http/envelope.js";
import { calculateProgressionLevel, levelTransition, utcDayRange } from "../progression/calculate.js";
import {
  createDailyGoals,
  createWeeklyGoals,
  goalPeriodRewards,
  utcWeekRange,
  type ProgressionGoal
} from "../progression/goals.js";
import { rateLimitFor } from "../rate-limit/policies.js";
import { incrementLeaderboardScores } from "./leaderboards.js";

type ProgressionNextActionCode =
  | "start_check_in"
  | "complete_activity"
  | "draw_bean"
  | "claim_daily_reward"
  | "claim_weekly_reward";

type ProgressionNextAction = {
  code: ProgressionNextActionCode;
  title: string;
  description: string;
  actionLabel: string;
  targetSection: "home" | "activities" | "beans" | "rankings" | "profile";
  priority: number;
  rewardPreview: {
    score: number;
    drawProgress: number;
    drawChances: number;
  } | null;
};

export async function registerProgressionRoutes(server: FastifyInstance) {
  server.get(
    "/v1/progression/summary",
    {
      ...rateLimitFor(server, "profileUpdates"),
      preHandler: [server.requireAuth]
    },
    async (request) => ok(await buildProgressionSummary(server, request.user!.id, new Date()))
  );

  server.post(
    "/v1/progression/:period/claim",
    {
      ...rateLimitFor(server, "profileUpdates"),
      preHandler: [server.requireAuth],
      schema: {
        params: {
          type: "object",
          required: ["period"],
          properties: {
            period: { type: "string", enum: ["daily", "weekly"] }
          }
        }
      }
    },
    async (request, reply) => {
      const { period } = request.params as { period: ProgressionPeriodType };
      const userId = request.user!.id;
      const now = new Date();
      const summary = await buildProgressionSummary(server, userId, now);
      const periodState = period === ProgressionPeriodType.daily
        ? summary.dailyGoals
        : summary.weeklyGoals;
      const fishTankPolicy = server.runtimeConfig.fishTank.existingLoopRewards;
      const sourceType: ExistingRewardSourceType =
        period === ProgressionPeriodType.daily ? "daily_goal_claim" : "weekly_goal_claim";

      if (!periodState.allCompleted) {
        const rejectedSourceId = `${period}:${periodState.periodStart.toISOString()}`;
        await recordAuditEventWithClient(server.prisma, {
          eventType: "fish_tank.existing_loop.rejected",
          actorUserId: userId,
          targetUserId: userId,
          sourceType: "progression_goal_period",
          metadata: buildExistingLoopAuditMetadata({
            sourceType,
            sourceId: rejectedSourceId,
            policyVersion: fishTankPolicy.policyVersion,
            outcome: "rejected",
            reason: "GOAL_PERIOD_INCOMPLETE"
          }),
          trace: request.trace
        });
        return reply
          .code(409)
          .send(fail("GOAL_PERIOD_INCOMPLETE", "Complete all goals before claiming", request.trace));
      }

      const rewardConfig = goalPeriodRewards[period];
      const beforeExperience = summary.experience;
      const plannedFishOutcomes = resolveExistingLoopOutcomes(sourceType, fishTankPolicy);

      const result = await server.prisma.$transaction(async (tx) => {
        await tx.progressionGoalPeriod.createMany({
          data: [{
            userId,
            periodType: period,
            periodStart: periodState.periodStart
          }],
          skipDuplicates: true
        });
        const row = await tx.progressionGoalPeriod.findUnique({
          where: {
            userId_periodType_periodStart: {
              userId,
              periodType: period,
              periodStart: periodState.periodStart
            }
          }
        });
        if (!row) {
          throw new Error("Progression goal period was not persisted");
        }

        const claimed = await tx.progressionGoalPeriod.updateMany({
          where: { id: row.id, claimedAt: null },
          data: { claimedAt: now }
        });
        if (claimed.count === 0) {
          return {
            awarded: false,
            sourceId: row.id,
            claimedAt: row.claimedAt ?? now,
            drawProgress: 0,
            drawChancesGranted: 0
          };
        }

        const stats = await tx.userStats.findUnique({ where: { userId } });
        const draw = nextDrawState(
          stats?.drawProgress ?? 0,
          rewardConfig.drawProgress,
          server.runtimeConfig.beans.drawProgressPerChance
        );

        await tx.userStats.upsert({
          where: { userId },
          create: {
            userId,
            drawProgress: draw.remainingProgress,
            drawChances: draw.chancesGranted
          },
          update: {
            drawProgress: draw.remainingProgress,
            drawChances: { increment: draw.chancesGranted }
          }
        });

        const metadata = {
          period,
          periodStart: periodState.periodStart.toISOString(),
          requestId: request.trace.requestId,
          traceId: request.trace.traceId,
          spanId: request.trace.spanId
        };
        const rewards: Prisma.RewardLedgerCreateManyInput[] = [
          {
            userId,
            sourceType: RewardSourceType.progression,
            sourceId: row.id,
            rewardType: RewardType.score,
            amount: rewardConfig.score,
            idempotencyKey: `progression:${row.id}:score`,
            metadata
          },
          {
            userId,
            sourceType: RewardSourceType.progression,
            sourceId: row.id,
            rewardType: RewardType.draw_progress,
            amount: rewardConfig.drawProgress,
            idempotencyKey: `progression:${row.id}:draw-progress`,
            metadata
          }
        ];
        if (draw.chancesGranted > 0) {
          rewards.push({
            userId,
            sourceType: RewardSourceType.progression,
            sourceId: row.id,
            rewardType: RewardType.draw_chance,
            amount: draw.chancesGranted,
            idempotencyKey: `progression:${row.id}:draw-chance`,
            metadata
          });
        }
        await tx.rewardLedger.createMany({ data: rewards, skipDuplicates: true });
        await incrementLeaderboardScores(tx, {
          userId,
          score: rewardConfig.score,
          now
        });

        await grantExistingLoopRewards(tx, userId, {
          sourceType,
          sourceId: row.id,
          policyVersion: fishTankPolicy.policyVersion,
          outcomes: plannedFishOutcomes,
          requestId: request.trace.requestId,
          traceId: request.trace.traceId
        });

        return {
          awarded: true,
          sourceId: row.id,
          claimedAt: now,
          drawProgress: rewardConfig.drawProgress,
          drawChancesGranted: draw.chancesGranted
        };
      }).catch(async (error) => {
        const rolledBackSourceId = `${period}:${periodState.periodStart.toISOString()}`;
        await recordAuditEventWithClient(server.prisma, {
          eventType: "fish_tank.existing_loop.rolled_back",
          actorUserId: userId,
          targetUserId: userId,
          sourceType: "progression_goal_period",
          metadata: buildExistingLoopAuditMetadata({
            sourceType,
            sourceId: rolledBackSourceId,
            policyVersion: fishTankPolicy.policyVersion,
            outcome: "rolled_back",
            outcomes: plannedFishOutcomes,
            reason: error instanceof Error ? error.name : "UNKNOWN_ERROR"
          }),
          trace: request.trace
        });
        throw error;
      });

      const fishTankOutcomes = result.awarded
        ? plannedFishOutcomes
        : await reconstructExistingLoopOutcomes(server.prisma, userId, {
            sourceType,
            sourceId: result.sourceId
          });

      const afterExperience = beforeExperience + (result.awarded ? rewardConfig.score : 0);
      const transition = levelTransition(beforeExperience, afterExperience);
      await recordAuditEventWithClient(server.prisma, {
        eventType: result.awarded ? "progression.goal_reward.claimed" : "progression.goal_reward.replayed",
        actorUserId: userId,
        targetUserId: userId,
        sourceType: "progression_goal_period",
        metadata: {
          period,
          periodStart: periodState.periodStart.toISOString(),
          reward: result.awarded
            ? {
                score: rewardConfig.score,
                drawProgress: result.drawProgress,
                drawChancesGranted: result.drawChancesGranted
              }
            : null,
          ...transition
        },
        trace: request.trace
      });

      const fishOutcome =
        result.awarded && fishTankOutcomes.length > 0
          ? "granted"
          : !result.awarded && fishTankOutcomes.length > 0
            ? "replayed"
            : "empty";
      await recordAuditEventWithClient(server.prisma, {
        eventType: `fish_tank.existing_loop.${fishOutcome}`,
        actorUserId: userId,
        targetUserId: userId,
        sourceType: "progression_goal_period",
        sourceId: result.sourceId,
        metadata: buildExistingLoopAuditMetadata({
          sourceType,
          sourceId: result.sourceId,
          policyVersion: fishTankPolicy.policyVersion,
          outcome: fishOutcome,
          outcomes: fishTankOutcomes,
          reason: result.awarded && fishOutcome === "empty" ? "POLICY_EMPTY" : undefined
        }),
        trace: request.trace
      });

      return ok({
        period,
        awarded: result.awarded,
        claimedAt: result.claimedAt.toISOString(),
        reward: {
          score: result.awarded ? rewardConfig.score : 0,
          drawProgress: result.drawProgress,
          drawChancesGranted: result.drawChancesGranted
        },
        progression: {
          ...calculateProgressionLevel(afterExperience),
          ...transition
        },
        fishTankOutcomes
      });
    }
  );
}

async function buildProgressionSummary(server: FastifyInstance, userId: string, now: Date) {
  const day = utcDayRange(now);
  const week = utcWeekRange(now);
  const [
    stats,
    allTimeScore,
    completedActivities,
    collectedBeanTypes,
    unlockedAchievements,
    weeklyCheckIns,
    weeklyActivities,
    weeklyBeanDraws,
    dailyPeriod,
    weeklyPeriod
  ] = await Promise.all([
    server.prisma.userStats.findUnique({ where: { userId } }),
    server.prisma.leaderboardScore.findUnique({
      where: {
        userId_window_windowStart: {
          userId,
          window: LeaderboardWindow.all_time,
          windowStart: new Date(0)
        }
      }
    }),
    server.prisma.activityAssignment.count({
      where: { userId, status: ActivityAssignmentStatus.completed }
    }),
    server.prisma.beanInventory.count({ where: { userId, quantity: { gt: 0 } } }),
    server.prisma.userAchievement.count({ where: { userId } }),
    server.prisma.checkInSession.findMany({
      where: {
        userId,
        rewarded: true,
        endedAt: { gte: week.start, lt: week.end }
      },
      select: { endedAt: true, eligibleDurationSeconds: true }
    }),
    server.prisma.activityAssignment.findMany({
      where: {
        userId,
        status: ActivityAssignmentStatus.completed,
        completedAt: { gte: week.start, lt: week.end }
      },
      select: { completedAt: true }
    }),
    server.prisma.rewardLedger.findMany({
      where: {
        userId,
        sourceType: RewardSourceType.bean_draw,
        createdAt: { gte: week.start, lt: week.end }
      },
      select: { createdAt: true }
    }),
    server.prisma.progressionGoalPeriod.findUnique({
      where: {
        userId_periodType_periodStart: {
          userId,
          periodType: ProgressionPeriodType.daily,
          periodStart: day.start
        }
      }
    }),
    server.prisma.progressionGoalPeriod.findUnique({
      where: {
        userId_periodType_periodStart: {
          userId,
          periodType: ProgressionPeriodType.weekly,
          periodStart: week.start
        }
      }
    })
  ]);

  const dailyGoals = createDailyGoals({
    checkIns: weeklyCheckIns.filter((item) => inRange(item.endedAt, day)).length,
    activities: weeklyActivities.filter((item) => inRange(item.completedAt, day)).length,
    beanDraws: weeklyBeanDraws.filter((item) => inRange(item.createdAt, day)).length
  });
  const activeDays = new Set(
    weeklyCheckIns
      .map((item) => item.endedAt?.toISOString().slice(0, 10))
      .filter((value): value is string => Boolean(value))
  ).size;
  const weeklyGoals = createWeeklyGoals({
    restMinutes: Math.floor(
      weeklyCheckIns.reduce((total, item) => total + (item.eligibleDurationSeconds ?? 0), 0) / 60
    ),
    activities: weeklyActivities.length,
    activeDays
  });

  const dailyPeriodState = serializeGoalPeriod(
    ProgressionPeriodType.daily,
    day.start,
    day.end,
    dailyGoals,
    dailyPeriod?.claimedAt ?? null
  );
  const weeklyPeriodState = serializeGoalPeriod(
    ProgressionPeriodType.weekly,
    week.start,
    week.end,
    weeklyGoals,
    weeklyPeriod?.claimedAt ?? null
  );

  return {
    ...calculateProgressionLevel(allTimeScore?.score ?? 0),
    currentStreakDays: stats?.currentStreakDays ?? 0,
    longestStreakDays: stats?.longestStreakDays ?? 0,
    lifetime: {
      totalSessions: stats?.totalSessions ?? 0,
      eligibleRestMinutes: Math.floor((stats?.eligibleDurationSeconds ?? 0) / 60),
      completedActivities,
      collectedBeanTypes,
      unlockedAchievements
    },
    dailyGoals: dailyPeriodState,
    weeklyGoals: weeklyPeriodState,
    nextActions: buildProgressionNextActions(dailyPeriodState, weeklyPeriodState)
  };
}

function serializeGoalPeriod(
  period: ProgressionPeriodType,
  start: Date,
  end: Date,
  goals: ProgressionGoal[],
  claimedAt: Date | null
) {
  const completed = goals.filter((goal) => goal.completed).length;
  const reward = goalPeriodRewards[period];
  return {
    period,
    periodStart: start,
    periodEnd: end,
    completed,
    total: goals.length,
    allCompleted: completed === goals.length,
    rewardClaimed: Boolean(claimedAt),
    claimedAt,
    reward,
    goals
  };
}

function inRange(value: Date | null, range: { start: Date; end: Date }) {
  return Boolean(value && value >= range.start && value < range.end);
}

export function buildProgressionNextActions(
  dailyGoals: ReturnType<typeof serializeGoalPeriod>,
  weeklyGoals: ReturnType<typeof serializeGoalPeriod>
): ProgressionNextAction[] {
  const actions: ProgressionNextAction[] = [];
  const dailyReward = dailyGoals.reward;
  const weeklyReward = weeklyGoals.reward;

  if (dailyGoals.allCompleted && !dailyGoals.rewardClaimed) {
    actions.push({
      code: "claim_daily_reward",
      title: "今日整组奖励可以领取",
      description: "今天的休息、任务和抽豆闭环已经跑通，先把奖励收下。",
      actionLabel: "领取今日奖励",
      targetSection: "home",
      priority: 10,
      rewardPreview: {
        score: dailyReward.score,
        drawProgress: dailyReward.drawProgress,
        drawChances: 0
      }
    });
  }

  if (weeklyGoals.allCompleted && !weeklyGoals.rewardClaimed) {
    actions.push({
      code: "claim_weekly_reward",
      title: "本周整组奖励可以领取",
      description: "这一周有在认真休息，给自己盖个章。",
      actionLabel: "领取本周奖励",
      targetSection: "home",
      priority: 15,
      rewardPreview: {
        score: weeklyReward.score,
        drawProgress: weeklyReward.drawProgress,
        drawChances: 0
      }
    });
  }

  const checkInGoal = dailyGoals.goals.find((goal) => goal.code === "check_in");
  if (checkInGoal && !checkInGoal.completed) {
    actions.push({
      code: "start_check_in",
      title: "先完成一次有效打卡",
      description: "今日闭环从一次至少 1 分钟的带薪休息开始。",
      actionLabel: "开始打卡",
      targetSection: "home",
      priority: 20,
      rewardPreview: { score: 1, drawProgress: 1, drawChances: 0 }
    });
  }

  const activityGoal = dailyGoals.goals.find((goal) => goal.code === "activity");
  if (activityGoal && !activityGoal.completed) {
    actions.push({
      code: "complete_activity",
      title: "补一个摸鱼任务",
      description: "做完一个随机活动，今日目标会继续往前推进。",
      actionLabel: "去领任务",
      targetSection: "activities",
      priority: checkInGoal?.completed ? 25 : 35,
      rewardPreview: { score: 5, drawProgress: 1, drawChances: 0 }
    });
  }

  const beanGoal = dailyGoals.goals.find((goal) => goal.code === "bean_draw");
  if (beanGoal && !beanGoal.completed) {
    actions.push({
      code: "draw_bean",
      title: "抽一颗今日命运豆",
      description: "把抽豆机会用掉，图鉴和每日目标都会更完整。",
      actionLabel: "去豆仓",
      targetSection: "beans",
      priority: activityGoal?.completed ? 30 : 45,
      rewardPreview: { score: 0, drawProgress: 0, drawChances: 0 }
    });
  }

  return actions.sort((left, right) => left.priority - right.priority);
}

function nextDrawState(currentProgress: number, granted: number, progressPerChance: number) {
  const total = currentProgress + granted;
  return {
    chancesGranted: Math.floor(total / progressPerChance),
    remainingProgress: total % progressPerChance
  };
}
