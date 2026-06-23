import {
  ActivityAssignmentStatus,
  LeaderboardWindow,
  RewardSourceType
} from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { ok } from "../http/envelope.js";
import { calculateProgressionLevel, utcDayRange } from "../progression/calculate.js";
import { rateLimitFor } from "../rate-limit/policies.js";

export async function registerProgressionRoutes(server: FastifyInstance) {
  server.get(
    "/v1/progression/summary",
    {
      ...rateLimitFor(server, "profileUpdates"),
      preHandler: [server.requireAuth]
    },
    async (request) => {
      const userId = request.user!.id;
      const now = new Date();
      const { start, end } = utcDayRange(now);

      const [
        stats,
        allTimeScore,
        completedActivities,
        collectedBeanTypes,
        unlockedAchievements,
        todayCheckIns,
        todayActivities,
        todayBeanDraws
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
          where: {
            userId,
            status: ActivityAssignmentStatus.completed
          }
        }),
        server.prisma.beanInventory.count({
          where: {
            userId,
            quantity: { gt: 0 }
          }
        }),
        server.prisma.userAchievement.count({ where: { userId } }),
        server.prisma.checkInSession.count({
          where: {
            userId,
            rewarded: true,
            endedAt: { gte: start, lt: end }
          }
        }),
        server.prisma.activityAssignment.count({
          where: {
            userId,
            status: ActivityAssignmentStatus.completed,
            completedAt: { gte: start, lt: end }
          }
        }),
        server.prisma.rewardLedger.count({
          where: {
            userId,
            sourceType: RewardSourceType.bean_draw,
            createdAt: { gte: start, lt: end }
          }
        })
      ]);

      const progression = calculateProgressionLevel(allTimeScore?.score ?? 0);
      const goals = [
        createGoal("check_in", "完成一次有效打卡", todayCheckIns > 0),
        createGoal("activity", "完成一个摸鱼任务", todayActivities > 0),
        createGoal("bean_draw", "抽取一颗工位命运豆", todayBeanDraws > 0)
      ];

      return ok({
        ...progression,
        currentStreakDays: stats?.currentStreakDays ?? 0,
        longestStreakDays: stats?.longestStreakDays ?? 0,
        lifetime: {
          totalSessions: stats?.totalSessions ?? 0,
          eligibleRestMinutes: Math.floor((stats?.eligibleDurationSeconds ?? 0) / 60),
          completedActivities,
          collectedBeanTypes,
          unlockedAchievements
        },
        dailyGoals: {
          date: start.toISOString().slice(0, 10),
          completed: goals.filter((goal) => goal.completed).length,
          total: goals.length,
          goals
        }
      });
    }
  );
}

function createGoal(
  code: "check_in" | "activity" | "bean_draw",
  title: string,
  completed: boolean
) {
  return {
    code,
    title,
    description:
      code === "check_in"
        ? "休息至少 1 分钟并完成结算"
        : code === "activity"
          ? "领取并完成一个随机摸鱼活动"
          : "攒满机会后抽取一颗收藏豆",
    completed
  };
}
