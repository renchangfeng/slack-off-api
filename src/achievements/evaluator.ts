import {
  AchievementRuleType,
  ActivityAssignmentStatus,
  LeaderboardWindow,
  RewardSourceType,
  RewardType,
  type Prisma,
  type PrismaClient
} from "@prisma/client";
import type { TraceContext } from "../observability/ids.js";
import { incrementLeaderboardScores } from "../routes/leaderboards.js";
import { calculateAchievementProgress } from "./progress.js";

type AchievementClient = PrismaClient | Prisma.TransactionClient;

type RewardConfig = {
  score?: number;
  drawProgress?: number;
  drawChance?: number;
  cosmeticCode?: string;
};

export type AchievementUnlock = {
  id: string;
  code: string;
  name: string;
  unlockedAt: string;
  rewards: {
    score: number;
    drawProgress: number;
    drawChances: number;
    cosmetic: string | null;
  };
};

export async function evaluateAchievements(
  prisma: PrismaClient,
  input: {
    userId: string;
    now?: Date;
    trace: TraceContext;
  }
): Promise<AchievementUnlock[]> {
  const now = input.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    const [achievements, existing, stats, beanCount, completedActivityCount, weeklyRank] =
      await Promise.all([
        tx.achievement.findMany({
          where: { active: true },
          orderBy: { code: "asc" }
        }),
        tx.userAchievement.findMany({
          where: { userId: input.userId },
          select: { achievementId: true }
        }),
        tx.userStats.findUnique({
          where: { userId: input.userId }
        }),
        tx.beanInventory.count({
          where: {
            userId: input.userId,
            quantity: { gt: 0 }
          }
        }),
        tx.activityAssignment.count({
          where: {
            userId: input.userId,
            status: ActivityAssignmentStatus.completed,
            rewarded: true
          }
        }),
        getWeeklyRank(tx, input.userId, now)
      ]);

    const unlockedIds = new Set(existing.map((achievement) => achievement.achievementId));
    const newlyUnlocked = achievements.filter(
      (achievement) =>
        !unlockedIds.has(achievement.id) &&
        calculateAchievementProgress(achievement.ruleType, achievement.ruleConfig, {
          totalSessions: stats?.totalSessions ?? 0,
          currentStreakDays: stats?.currentStreakDays ?? 0,
          eligibleDurationSeconds: stats?.eligibleDurationSeconds ?? 0,
          beanCount,
          completedActivityCount,
          weeklyRank
        }).completed
    );

    const unlocks: AchievementUnlock[] = [];
    for (const achievement of newlyUnlocked) {
      const rewards = toRewardConfig(achievement.rewardConfig);
      const rewardSummary = await awardAchievementRewards(tx, {
        userId: input.userId,
        achievementId: achievement.id,
        achievementCode: achievement.code,
        rewards,
        now,
        trace: input.trace
      });

      await tx.userAchievement.create({
        data: {
          userId: input.userId,
          achievementId: achievement.id,
          unlockedAt: now,
          rewardClaimedAt: now
        }
      });

      await tx.auditEvent.create({
        data: {
          eventType: "achievement.unlocked",
          actorUserId: input.userId,
          targetUserId: input.userId,
          requestId: input.trace.requestId,
          traceId: input.trace.traceId,
          spanId: input.trace.spanId,
          sourceType: "achievement",
          sourceId: achievement.id,
          metadata: {
            achievementCode: achievement.code,
            reward: rewardSummary
          }
        }
      });

      unlocks.push({
        id: achievement.id,
        code: achievement.code,
        name: achievement.name,
        unlockedAt: now.toISOString(),
        rewards: rewardSummary
      });
    }

    return unlocks;
  });
}

async function awardAchievementRewards(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    achievementId: string;
    achievementCode: string;
    rewards: RewardConfig;
    now: Date;
    trace: TraceContext;
  }
): Promise<AchievementUnlock["rewards"]> {
  const rewardRows: Prisma.RewardLedgerCreateManyInput[] = [];
  let drawChancesGranted = input.rewards.drawChance ?? 0;
  let cosmeticName: string | null = null;

  if ((input.rewards.score ?? 0) > 0) {
    rewardRows.push(createRewardRow(input, RewardType.score, input.rewards.score!));
    await incrementLeaderboardScores(tx, {
      userId: input.userId,
      score: input.rewards.score!,
      now: input.now
    });
  }

  if ((input.rewards.drawProgress ?? 0) > 0) {
    rewardRows.push(createRewardRow(input, RewardType.draw_progress, input.rewards.drawProgress!));
    await tx.userStats.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        drawProgress: input.rewards.drawProgress!,
        drawChances: drawChancesGranted
      },
      update: {
        drawProgress: { increment: input.rewards.drawProgress! }
      }
    });
  }

  if (drawChancesGranted > 0) {
    rewardRows.push(createRewardRow(input, RewardType.draw_chance, drawChancesGranted));
    await tx.userStats.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        drawChances: drawChancesGranted
      },
      update: {
        drawChances: { increment: drawChancesGranted }
      }
    });
  }

  if (input.rewards.cosmeticCode) {
    const cosmetic = await tx.cosmetic.findUnique({
      where: { code: input.rewards.cosmeticCode }
    });

    if (cosmetic?.active) {
      cosmeticName = cosmetic.name;
      await tx.userCosmetic.upsert({
        where: {
          userId_cosmeticId: {
            userId: input.userId,
            cosmeticId: cosmetic.id
          }
        },
        create: {
          userId: input.userId,
          cosmeticId: cosmetic.id,
          unlockedAt: input.now,
          sourceType: RewardSourceType.achievement
        },
        update: {}
      });
      rewardRows.push(createRewardRow(input, RewardType.cosmetic, 1, { cosmeticCode: cosmetic.code }));
    }
  }

  if (rewardRows.length > 0) {
    await tx.rewardLedger.createMany({ data: rewardRows });
  }

  return {
    score: input.rewards.score ?? 0,
    drawProgress: input.rewards.drawProgress ?? 0,
    drawChances: drawChancesGranted,
    cosmetic: cosmeticName
  };
}

function createRewardRow(
  input: {
    userId: string;
    achievementId: string;
    achievementCode: string;
    trace: TraceContext;
  },
  rewardType: RewardType,
  amount: number,
  extraMetadata: Prisma.InputJsonObject = {}
): Prisma.RewardLedgerCreateManyInput {
  return {
    userId: input.userId,
    sourceType: RewardSourceType.achievement,
    sourceId: input.achievementId,
    rewardType,
    amount,
    metadata: {
      requestId: input.trace.requestId,
      traceId: input.trace.traceId,
      spanId: input.trace.spanId,
      achievementCode: input.achievementCode,
      ...extraMetadata
    }
  };
}

export async function getWeeklyRank(
  prisma: AchievementClient,
  userId: string,
  now: Date
): Promise<number | null> {
  const windowStart = getWeeklyWindowStart(now);
  const score = await prisma.leaderboardScore.findUnique({
    where: {
      userId_window_windowStart: {
        userId,
        window: LeaderboardWindow.weekly,
        windowStart
      }
    }
  });

  if (!score) {
    return null;
  }

  const ahead = await prisma.leaderboardScore.count({
    where: {
      window: LeaderboardWindow.weekly,
      windowStart,
      score: { gt: score.score }
    }
  });

  return ahead + 1;
}

function getWeeklyWindowStart(now: Date): Date {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = start.getUTCDay() || 7;
  start.setUTCDate(start.getUTCDate() - day + 1);
  return start;
}

function toRewardConfig(value: Prisma.JsonValue): RewardConfig {
  return isObject(value) ? value : {};
}

function isObject(value: Prisma.JsonValue): value is Record<string, number | string> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
