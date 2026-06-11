import {
  ActivityAssignmentStatus,
  RewardSourceType,
  RewardType,
  type ActivityDifficulty,
  type ActivityTemplate,
  type Prisma
} from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { evaluateAchievements } from "../achievements/evaluator.js";
import { recordAuditEventWithClient } from "../audit/events.js";
import { fail, ok } from "../http/envelope.js";
import { rateLimitFor } from "../rate-limit/policies.js";
import { incrementLeaderboardScores } from "./leaderboards.js";

type RewardConfig = {
  score?: number;
  drawProgress?: number;
};

export async function registerActivityRoutes(server: FastifyInstance) {
  server.post(
    "/v1/activities/random",
    {
      ...rateLimitFor(server, "activities"),
      preHandler: [server.requireAuth]
    },
    async (request, reply) => {
      const now = new Date();
      const active = await server.prisma.activityAssignment.findFirst({
        where: {
          userId: request.user!.id,
          status: ActivityAssignmentStatus.active
        },
        orderBy: { assignedAt: "desc" },
        include: { template: true }
      });

      if (active && (!active.expiresAt || active.expiresAt > now)) {
        return ok(serializeAssignment(active));
      }

      if (active?.expiresAt && active.expiresAt <= now) {
        await server.prisma.activityAssignment.update({
          where: { id: active.id },
          data: { status: ActivityAssignmentStatus.expired }
        });
      }

      const templates = await server.prisma.activityTemplate.findMany({
        where: { active: true },
        orderBy: { code: "asc" }
      });

      const eligible = await filterEligibleTemplates(server, request.user!.id, templates, now);
      if (eligible.length === 0) {
        await recordAuditEventWithClient(server.prisma, {
          eventType: "activity.random.rejected",
          actorUserId: request.user!.id,
          targetUserId: request.user!.id,
          sourceType: "activity_template",
          metadata: { reason: "NO_ELIGIBLE_ACTIVITY" },
          trace: request.trace
        });

        return reply
          .code(409)
          .send(fail("NO_ELIGIBLE_ACTIVITY", "No eligible activity available", request.trace));
      }

      const template = eligible[Math.floor(Math.random() * eligible.length)];
      const assignment = await server.prisma.activityAssignment.create({
        data: {
          userId: request.user!.id,
          templateId: template.id,
          status: ActivityAssignmentStatus.active,
          assignedAt: now,
          expiresAt: new Date(now.getTime() + 1000 * 60 * 30)
        },
        include: { template: true }
      });

      await recordAuditEventWithClient(server.prisma, {
        eventType: "activity.random.assigned",
        actorUserId: request.user!.id,
        targetUserId: request.user!.id,
        sourceType: "activity_assignment",
        sourceId: assignment.id,
        metadata: {
          templateCode: template.code,
          difficulty: template.difficulty
        },
        trace: request.trace
      });

      return ok(serializeAssignment(assignment));
    }
  );

  server.post(
    "/v1/activities/:assignmentId/complete",
    {
      ...rateLimitFor(server, "activities"),
      preHandler: [server.requireAuth],
      schema: {
        params: {
          type: "object",
          required: ["assignmentId"],
          properties: {
            assignmentId: { type: "string", format: "uuid" }
          }
        }
      }
    },
    async (request, reply) => {
      const params = request.params as { assignmentId: string };
      const now = new Date();
      const assignment = await server.prisma.activityAssignment.findUnique({
        where: { id: params.assignmentId },
        include: { template: true }
      });

      if (!assignment || assignment.userId !== request.user?.id) {
        return reply
          .code(404)
          .send(fail("ACTIVITY_NOT_FOUND", "Activity assignment not found", request.trace));
      }

      if (assignment.status !== ActivityAssignmentStatus.active) {
        return ok({
          assignment: serializeAssignment(assignment),
          reward: {
            score: 0,
            drawProgress: 0,
            drawChancesGranted: 0,
            rewarded: assignment.rewarded,
            reason: "ALREADY_COMPLETED",
            achievementsUnlocked: []
          }
        });
      }

      if (assignment.expiresAt && assignment.expiresAt <= now) {
        await server.prisma.activityAssignment.update({
          where: { id: assignment.id },
          data: { status: ActivityAssignmentStatus.expired }
        });
        await recordAuditEventWithClient(server.prisma, {
          eventType: "activity.complete.rejected",
          actorUserId: request.user!.id,
          targetUserId: request.user!.id,
          sourceType: "activity_assignment",
          sourceId: assignment.id,
          metadata: { reason: "ACTIVITY_EXPIRED" },
          trace: request.trace
        });

        return reply
          .code(409)
          .send(fail("ACTIVITY_EXPIRED", "Activity assignment expired", request.trace));
      }

      const dailyCompleted = await countTodayRewardedAssignments(
        server,
        request.user!.id,
        assignment.templateId,
        now
      );
      const dailyLimitReached = dailyCompleted >= assignment.template.dailyRewardLimit;
      const rewardConfig = toRewardConfig(assignment.template.rewardConfig);
      let drawChancesGranted = 0;
      const reward = await server.prisma.$transaction(async (tx) => {
        await tx.activityAssignment.update({
          where: { id: assignment.id },
          data: {
            status: ActivityAssignmentStatus.completed,
            completedAt: now,
            rewarded: !dailyLimitReached
          }
        });

        if (dailyLimitReached) {
          return {
            score: 0,
            drawProgress: 0,
            drawChancesGranted: 0,
            rewarded: false,
            reason: "DAILY_LIMIT_REACHED"
          };
        }

        const stats = await tx.userStats.findUnique({
          where: { userId: request.user!.id }
        });
        const draw = nextDrawState(
          stats?.drawProgress ?? 0,
          rewardConfig.drawProgress ?? 0,
          server.runtimeConfig.beans.drawProgressPerChance
        );
        drawChancesGranted = draw.chancesGranted;

        await tx.userStats.upsert({
          where: { userId: request.user!.id },
          create: {
            userId: request.user!.id,
            drawProgress: draw.remainingProgress,
            drawChances: draw.chancesGranted
          },
          update: {
            drawProgress: draw.remainingProgress,
            drawChances: { increment: draw.chancesGranted }
          }
        });

        const rewardRows: Prisma.RewardLedgerCreateManyInput[] = [];
        if ((rewardConfig.score ?? 0) > 0) {
          rewardRows.push(createRewardRow(request.user!.id, assignment.id, RewardType.score, rewardConfig.score!, request.trace));
          await incrementLeaderboardScores(tx, {
            userId: request.user!.id,
            score: rewardConfig.score!,
            now
          });
        }

        if ((rewardConfig.drawProgress ?? 0) > 0) {
          rewardRows.push(createRewardRow(request.user!.id, assignment.id, RewardType.draw_progress, rewardConfig.drawProgress!, request.trace));
        }

        if (draw.chancesGranted > 0) {
          rewardRows.push(createRewardRow(request.user!.id, assignment.id, RewardType.draw_chance, draw.chancesGranted, request.trace));
        }

        if (rewardRows.length > 0) {
          await tx.rewardLedger.createMany({ data: rewardRows });
        }

        return {
          score: rewardConfig.score ?? 0,
          drawProgress: rewardConfig.drawProgress ?? 0,
          drawChancesGranted: draw.chancesGranted,
          rewarded: true,
          reason: null
        };
      });

      await recordAuditEventWithClient(server.prisma, {
        eventType: dailyLimitReached ? "activity.complete.no_reward" : "activity.complete.rewarded",
        actorUserId: request.user!.id,
        targetUserId: request.user!.id,
        sourceType: "activity_assignment",
        sourceId: assignment.id,
        metadata: {
          templateCode: assignment.template.code,
          dailyLimitReached,
          reward: {
            score: reward.score,
            drawProgress: reward.drawProgress,
            drawChancesGranted
          }
        },
        trace: request.trace
      });

      const achievementsUnlocked = await evaluateAchievements(server.prisma, {
        userId: request.user!.id,
        now,
        trace: request.trace
      });

      return ok({
        assignment: serializeAssignment({
          ...assignment,
          status: ActivityAssignmentStatus.completed,
          completedAt: now,
          rewarded: reward.rewarded
        }),
        reward: {
          ...reward,
          achievementsUnlocked
        }
      });
    }
  );
}

async function filterEligibleTemplates(
  server: FastifyInstance,
  userId: string,
  templates: ActivityTemplate[],
  now: Date
): Promise<ActivityTemplate[]> {
  const assignments = await server.prisma.activityAssignment.findMany({
    where: {
      userId,
      templateId: { in: templates.map((template) => template.id) }
    }
  });

  return templates.filter((template) => {
    const latest = assignments
      .filter((assignment) => assignment.templateId === template.id)
      .sort((left, right) => {
        const leftTime = (left.completedAt ?? left.assignedAt).getTime();
        const rightTime = (right.completedAt ?? right.assignedAt).getTime();
        return rightTime - leftTime;
      })[0];

    if (!latest) {
      return true;
    }

    const latestTime = latest.completedAt ?? latest.assignedAt;
    return now.getTime() - latestTime.getTime() >= template.cooldownSeconds * 1000;
  });
}

async function countTodayRewardedAssignments(
  server: FastifyInstance,
  userId: string,
  templateId: string,
  now: Date
): Promise<number> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  return server.prisma.activityAssignment.count({
    where: {
      userId,
      templateId,
      status: ActivityAssignmentStatus.completed,
      rewarded: true,
      completedAt: {
        gte: start,
        lt: end
      }
    }
  });
}

function serializeAssignment(assignment: {
  id: string;
  status: ActivityAssignmentStatus;
  assignedAt: Date;
  completedAt?: Date | null;
  expiresAt: Date | null;
  rewarded: boolean;
  template: {
    title: string;
    description: string;
    difficulty: ActivityDifficulty;
    rewardConfig: Prisma.JsonValue;
  };
}) {
  const reward = toRewardConfig(assignment.template.rewardConfig);
  return {
    assignmentId: assignment.id,
    title: assignment.template.title,
    description: assignment.template.description,
    difficulty: assignment.template.difficulty,
    status: assignment.status,
    rewardPreview: {
      score: reward.score ?? 0,
      drawProgress: reward.drawProgress ?? 0
    },
    assignedAt: assignment.assignedAt.toISOString(),
    completedAt: assignment.completedAt?.toISOString() ?? null,
    expiresAt: assignment.expiresAt?.toISOString() ?? null,
    rewarded: assignment.rewarded
  };
}

function createRewardRow(
  userId: string,
  sourceId: string,
  rewardType: RewardType,
  amount: number,
  trace: { requestId: string; traceId: string; spanId: string }
): Prisma.RewardLedgerCreateManyInput {
  return {
    userId,
    sourceType: RewardSourceType.activity,
    sourceId,
    rewardType,
    amount,
    metadata: {
      requestId: trace.requestId,
      traceId: trace.traceId,
      spanId: trace.spanId
    }
  };
}

function nextDrawState(
  currentProgress: number,
  progressGranted: number,
  progressPerChance: number
) {
  const totalProgress = currentProgress + progressGranted;
  return {
    chancesGranted: Math.floor(totalProgress / progressPerChance),
    remainingProgress: totalProgress % progressPerChance
  };
}

function toRewardConfig(value: Prisma.JsonValue): RewardConfig {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}
