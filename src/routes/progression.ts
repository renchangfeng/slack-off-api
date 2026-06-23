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

      if (!periodState.allCompleted) {
        return reply
          .code(409)
          .send(fail("GOAL_PERIOD_INCOMPLETE", "Complete all goals before claiming", request.trace));
      }

      const rewardConfig = goalPeriodRewards[period];
      const beforeExperience = summary.experience;
      const result = await server.prisma.$transaction(async (tx) => {
        const row = await tx.progressionGoalPeriod.upsert({
          where: {
            userId_periodType_periodStart: {
              userId,
              periodType: period,
              periodStart: periodState.periodStart
            }
          },
          create: {
            userId,
            periodType: period,
            periodStart: periodState.periodStart
          },
          update: {}
        });

        const claimed = await tx.progressionGoalPeriod.updateMany({
          where: { id: row.id, claimedAt: null },
          data: { claimedAt: now }
        });
        if (claimed.count === 0) {
          return {
            awarded: false,
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

        return {
          awarded: true,
          claimedAt: now,
          drawProgress: rewardConfig.drawProgress,
          drawChancesGranted: draw.chancesGranted
        };
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
        }
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
    dailyGoals: serializeGoalPeriod(
      ProgressionPeriodType.daily,
      day.start,
      day.end,
      dailyGoals,
      dailyPeriod?.claimedAt ?? null
    ),
    weeklyGoals: serializeGoalPeriod(
      ProgressionPeriodType.weekly,
      week.start,
      week.end,
      weeklyGoals,
      weeklyPeriod?.claimedAt ?? null
    )
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

function nextDrawState(currentProgress: number, granted: number, progressPerChance: number) {
  const total = currentProgress + granted;
  return {
    chancesGranted: Math.floor(total / progressPerChance),
    remainingProgress: total % progressPerChance
  };
}
