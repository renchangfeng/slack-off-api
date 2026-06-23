import { ActivityAssignmentStatus, CosmeticType } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { getWeeklyRank } from "../achievements/evaluator.js";
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

      return ok({
        achievements: achievements.map((achievement) => {
          const progress = calculateAchievementProgress(
            achievement.ruleType,
            achievement.ruleConfig,
            progressInput
          );
          return {
            id: achievement.id,
            code: achievement.code,
            name: achievement.name,
            description: achievement.description,
            ruleType: achievement.ruleType,
            rewardConfig: achievement.rewardConfig,
            progress,
            unlockedAt: achievement.users[0]?.unlockedAt.toISOString() ?? null,
            rewardClaimedAt: achievement.users[0]?.rewardClaimedAt?.toISOString() ?? null
          };
        })
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
      const [owned, profile] = await Promise.all([
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
        })
      ]);

      return ok({
        equippedBadge: profile?.equippedBadge ? serializeCosmetic(profile.equippedBadge) : null,
        equippedTitle: profile?.equippedTitle ? serializeCosmetic(profile.equippedTitle) : null,
        cosmetics: owned.map((item) => ({
          ...serializeCosmetic(item.cosmetic),
          unlockedAt: item.unlockedAt.toISOString(),
          equipped:
            item.cosmeticId === profile?.equippedBadgeId ||
            item.cosmeticId === profile?.equippedTitleId
        }))
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

function serializeCosmetic(cosmetic: {
  id: string;
  code: string;
  name: string;
  description: string;
  cosmeticType: CosmeticType;
  rarity: string;
}) {
  return {
    id: cosmetic.id,
    code: cosmetic.code,
    name: cosmetic.name,
    description: cosmetic.description,
    cosmeticType: cosmetic.cosmeticType,
    rarity: cosmetic.rarity
  };
}
