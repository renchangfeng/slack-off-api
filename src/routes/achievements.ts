import { ActivityAssignmentStatus, CosmeticType } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { getWeeklyRank } from "../achievements/evaluator.js";
import {
  buildAchievementRecommendations,
  readAchievementMetadata,
  type SerializedAchievementForRecommendation
} from "../achievements/metadata.js";
import { calculateAchievementProgress } from "../achievements/progress.js";
import { recordAuditEventWithClient } from "../audit/events.js";
import { fail, ok } from "../http/envelope.js";
import { rateLimitFor } from "../rate-limit/policies.js";

export async function registerAchievementRoutes(server: FastifyInstance) {
  server.get(
    "/v1/achievements",
    {
      ...rateLimitFor(server, "profileUpdates"),
      preHandler: [server.requireAuth]
    },
    async (request) => {
      const userId = request.user!.id;
      const now = new Date();
      const [achievements, stats, beanCount, completedActivityCount, weeklyRank] =
        await Promise.all([
          server.prisma.achievement.findMany({
            where: { active: true },
            orderBy: { code: "asc" },
            include: {
              users: {
                where: { userId }
              }
            }
          }),
          server.prisma.userStats.findUnique({ where: { userId } }),
          server.prisma.beanInventory.count({
            where: { userId, quantity: { gt: 0 } }
          }),
          server.prisma.activityAssignment.count({
            where: {
              userId,
              status: ActivityAssignmentStatus.completed,
              rewarded: true
            }
          }),
          getWeeklyRank(server.prisma, userId, now)
        ]);

      const progressInput = {
        totalSessions: stats?.totalSessions ?? 0,
        currentStreakDays: stats?.currentStreakDays ?? 0,
        eligibleDurationSeconds: stats?.eligibleDurationSeconds ?? 0,
        beanCount,
        completedActivityCount,
        weeklyRank
      };
      const serializedAchievements = achievements.map((achievement) => {
        const progress = calculateAchievementProgress(
          achievement.ruleType,
          achievement.ruleConfig,
          progressInput
        );
        const metadata = readAchievementMetadata({
          code: achievement.code,
          ruleType: achievement.ruleType,
          ruleConfig: achievement.ruleConfig
        });
        return {
          id: achievement.id,
          code: achievement.code,
          name: achievement.name,
          description: achievement.description,
          ruleType: achievement.ruleType,
          rewardConfig: achievement.rewardConfig,
          progress,
          category: metadata.category,
          rarity: metadata.rarity,
          unlockSummary: metadata.unlockSummary,
          recommendationWeight: metadata.weight,
          todayFriendly: metadata.todayFriendly,
          actionHint: metadata.actionHint,
          unlockedAt: achievement.users[0]?.unlockedAt.toISOString() ?? null,
          rewardClaimedAt: achievement.users[0]?.rewardClaimedAt?.toISOString() ?? null
        };
      });

      return ok({
        achievements: serializedAchievements,
        recommendations: buildAchievementRecommendations(
          serializedAchievements as SerializedAchievementForRecommendation[]
        )
      });
    }
  );

  server.get(
    "/v1/cosmetics",
    {
      ...rateLimitFor(server, "profileUpdates"),
      preHandler: [server.requireAuth]
    },
    async (request) => {
      const [owned, profile, allCosmetics, achievements] = await Promise.all([
        server.prisma.userCosmetic.findMany({
          where: { userId: request.user!.id },
          orderBy: { unlockedAt: "desc" },
          include: { cosmetic: true }
        }),
        server.prisma.userProfile.findUnique({
          where: { userId: request.user!.id },
          include: {
            equippedBadge: true,
            equippedTitle: true
          }
        }),
        server.prisma.cosmetic.findMany({
          where: { active: true },
          orderBy: [{ rarity: "asc" }, { name: "asc" }]
        }),
        server.prisma.achievement.findMany({
          where: { active: true }
        })
      ]);
      const ownedByCosmeticId = new Map(owned.map((item) => [item.cosmeticId, item]));
      const unlockSummaries = buildCosmeticUnlockSummaries(achievements);

      return ok({
        equippedBadge: profile?.equippedBadge
          ? serializeCosmetic(profile.equippedBadge, unlockSummaries.get(profile.equippedBadge.code))
          : null,
        equippedTitle: profile?.equippedTitle
          ? serializeCosmetic(profile.equippedTitle, unlockSummaries.get(profile.equippedTitle.code))
          : null,
        cosmetics: allCosmetics.map((cosmetic) => {
          const ownedItem = ownedByCosmeticId.get(cosmetic.id);
          return {
            ...serializeCosmetic(cosmetic, unlockSummaries.get(cosmetic.code)),
            owned: Boolean(ownedItem),
            unlockedAt: ownedItem?.unlockedAt.toISOString() ?? null,
            equipped:
              cosmetic.id === profile?.equippedBadgeId ||
              cosmetic.id === profile?.equippedTitleId
          };
        })
      });
    }
  );

  server.post(
    "/v1/cosmetics/:id/equip",
    {
      ...rateLimitFor(server, "profileUpdates"),
      preHandler: [server.requireAuth],
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", format: "uuid" }
          }
        }
      }
    },
    async (request, reply) => {
      const params = request.params as { id: string };
      const owned = await server.prisma.userCosmetic.findUnique({
        where: {
          userId_cosmeticId: {
            userId: request.user!.id,
            cosmeticId: params.id
          }
        },
        include: { cosmetic: true }
      });

      if (!owned || !owned.cosmetic.active) {
        return reply
          .code(404)
          .send(fail("COSMETIC_NOT_FOUND", "Cosmetic not found", request.trace));
      }

      const data =
        owned.cosmetic.cosmeticType === CosmeticType.badge
          ? { equippedBadgeId: owned.cosmeticId }
          : { equippedTitleId: owned.cosmeticId };

      await server.prisma.userProfile.upsert({
        where: { userId: request.user!.id },
        create: {
          userId: request.user!.id,
          ...data
        },
        update: data
      });

      await recordAuditEventWithClient(server.prisma, {
        eventType: "cosmetic.equipped",
        actorUserId: request.user!.id,
        targetUserId: request.user!.id,
        sourceType: "cosmetic",
        sourceId: owned.cosmeticId,
        metadata: {
          cosmeticCode: owned.cosmetic.code,
          cosmeticType: owned.cosmetic.cosmeticType
        },
        trace: request.trace
      });

      return ok({
        cosmetic: serializeCosmetic(owned.cosmetic)
      });
    }
  );
}

function buildCosmeticUnlockSummaries(
  achievements: Array<{
    ruleType: Parameters<typeof readAchievementMetadata>[0]["ruleType"];
    ruleConfig: Parameters<typeof readAchievementMetadata>[0]["ruleConfig"];
    rewardConfig: unknown;
    code: string;
  }>
) {
  const summaries = new Map<string, string>();
  for (const achievement of achievements) {
    const cosmeticCode = readRewardCosmeticCode(achievement.rewardConfig);
    if (!cosmeticCode) {
      continue;
    }
    const metadata = readAchievementMetadata({
      code: achievement.code,
      ruleType: achievement.ruleType,
      ruleConfig: achievement.ruleConfig
    });
    summaries.set(cosmeticCode, metadata.unlockSummary);
  }
  return summaries;
}

function readRewardCosmeticCode(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const cosmeticCode = (value as { cosmeticCode?: unknown }).cosmeticCode;
  return typeof cosmeticCode === "string" ? cosmeticCode : null;
}

function serializeCosmetic(cosmetic: {
  id: string;
  code: string;
  name: string;
  description: string;
  cosmeticType: CosmeticType;
  rarity: string;
}, unlockSummary?: string) {
  return {
    id: cosmetic.id,
    code: cosmetic.code,
    name: cosmetic.name,
    description: cosmetic.description,
    cosmeticType: cosmetic.cosmeticType,
    rarity: cosmetic.rarity,
    unlockSummary: unlockSummary ?? "完成对应成就后解锁"
  };
}
