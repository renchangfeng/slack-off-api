import {
  ActivityAssignmentStatus,
  RewardSourceType,
  RewardType,
  type ActivityCategory,
  type ActivityDifficulty,
  type ActivityTemplate,
  type Prisma
} from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { evaluateAchievements } from "../achievements/evaluator.js";
import { recordAuditEventWithClient } from "../audit/events.js";
import {
  buildActivityInteraction,
  buildActivityPresentation,
  pickCompletionFeedback,
  summarizeActivityInteraction,
  summarizeCompletedSteps,
  validateActivityInteractionProgress,
  type ActivityInteractionProgress
} from "../activities/interaction.js";
import {
  canonicalActivityCategories,
  activitySkipReasons,
  explainActivityRecommendation,
  isCanonicalActivityCategory,
  normalizeActivityCategory,
  recommendActivity,
  type ActivitySkipReason,
  type CanonicalActivityCategory
} from "../activities/recommendation.js";
import { fail, ok } from "../http/envelope.js";
import { rateLimitFor } from "../rate-limit/policies.js";
import { incrementLeaderboardScores } from "./leaderboards.js";

type RewardConfig = {
  score?: number;
  drawProgress?: number;
};

export async function registerActivityRoutes(server: FastifyInstance) {
  server.get(
    "/v1/activities/catalog",
    {
      ...rateLimitFor(server, "activities"),
      preHandler: [server.requireAuth],
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            category: {
              type: "string",
              enum: canonicalActivityCategories
            }
          }
        }
      }
    },
    async (request) => {
      const query = request.query as { category?: CanonicalActivityCategory };
      const now = new Date();
      const templates = await server.prisma.activityTemplate.findMany({
        where: { active: true },
        orderBy: { code: "asc" }
      });
      const states = await buildActivityStates(server, request.user!.id, templates, now);
      const items = states
        .filter((state) => !query.category || state.category === query.category)
        .map((state) => serializeCatalogItem(state, now));

      return ok({
        selectedCategory: query.category ?? null,
        categories: canonicalActivityCategories,
        items
      });
    }
  );

  server.get(
    "/v1/activities/history",
    {
      ...rateLimitFor(server, "activities"),
      preHandler: [server.requireAuth],
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 50, default: 10 }
          }
        }
      }
    },
    async (request) => {
      const query = request.query as { limit?: number };
      const assignments = await server.prisma.activityAssignment.findMany({
        where: {
          userId: request.user!.id,
          status: {
            in: [
              ActivityAssignmentStatus.completed,
              ActivityAssignmentStatus.expired,
              ActivityAssignmentStatus.skipped
            ]
          }
        },
        orderBy: { assignedAt: "desc" },
        take: query.limit ?? 10,
        include: { template: true }
      });

      return ok({
        items: assignments.map(serializeAssignment)
      });
    }
  );

  server.post(
    "/v1/activities/random",
    {
      ...rateLimitFor(server, "activities"),
      preHandler: [server.requireAuth]
    },
    async (request, reply) => {
      const body = (request.body ?? {}) as { category?: string };
      if (body.category && !isCanonicalActivityCategory(body.category)) {
        return reply
          .code(400)
          .send(fail("INVALID_ACTIVITY_CATEGORY", "Invalid activity category", request.trace));
      }
      const preferredCategory = isCanonicalActivityCategory(body.category)
        ? body.category
        : undefined;
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
        return ok({
          ...serializeAssignment(active),
          recommendationReason: "ACTIVE_ASSIGNMENT",
          recommendationExplanation: explainActivityRecommendation({
            reason: "ACTIVE_ASSIGNMENT"
          })
        });
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

      const states = await buildActivityStates(server, request.user!.id, templates, now);
      const recentSkipReasons = await loadRecentSkipReasons(server, request.user!.id);
      const recommendation = recommendActivity(states.map((state) => ({
        value: state.template,
        category: state.category,
        eligible: state.eligible,
        difficulty: state.template.difficulty,
        interactionSummary: summarizeActivityInteraction(buildActivityInteraction(state.template)),
        completedCount: state.completedCount,
        categoryCompletionCount: state.categoryCompletionCount,
        lastUsedAt: state.lastUsedAt
      })), {
        preferredCategory,
        recentSkipReasons,
        now
      });
      if (!recommendation) {
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

      const template = recommendation.value;
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
          difficulty: template.difficulty,
          preferredCategory: preferredCategory ?? null,
          recommendationReason: recommendation.reason,
          recommendationExplanation: explainActivityRecommendation({
            reason: recommendation.reason,
            preferredCategory,
            recentSkipReasons
          })
        },
        trace: request.trace
      });

      return ok({
        ...serializeAssignment(assignment),
        recommendationReason: recommendation.reason,
        recommendationExplanation: explainActivityRecommendation({
          reason: recommendation.reason,
          preferredCategory,
          recentSkipReasons
        })
      });
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
      const body = (request.body ?? {}) as { interaction?: ActivityInteractionProgress };
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

      const interaction = buildActivityInteraction(assignment.template);
      const interactionValidation = validateActivityInteractionProgress(interaction, body.interaction);
      if (!interactionValidation.ok) {
        await recordAuditEventWithClient(server.prisma, {
          eventType: "activity.complete.rejected",
          actorUserId: request.user!.id,
          targetUserId: request.user!.id,
          sourceType: "activity_assignment",
          sourceId: assignment.id,
          metadata: {
            reason: "INTERACTION_INCOMPLETE",
            missingStepIds: interactionValidation.missingStepIds
          },
          trace: request.trace
        });

        return reply
          .code(409)
          .send(fail("INTERACTION_INCOMPLETE", "Complete all activity steps first", request.trace));
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
        },
        feedback: pickCompletionFeedback(interaction, assignment.id),
        resultTitle: interaction.resultSummary.title,
        resultCopy: interaction.resultSummary.copy,
        stepSummaries: summarizeCompletedSteps(interaction, body.interaction)
      });
    }
  );

  server.post(
    "/v1/activities/:assignmentId/skip",
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
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            reason: { type: "string", enum: activitySkipReasons }
          }
        }
      }
    },
    async (request, reply) => {
      const params = request.params as { assignmentId: string };
      const body = (request.body ?? {}) as { reason?: ActivitySkipReason };
      const reason = body.reason && activitySkipReasons.includes(body.reason)
        ? body.reason
        : undefined;
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
        return ok(serializeAssignment(assignment));
      }

      const skipped = await server.prisma.activityAssignment.update({
        where: { id: assignment.id },
        data: { status: ActivityAssignmentStatus.skipped }
      });

      await recordAuditEventWithClient(server.prisma, {
        eventType: "activity.skipped",
        actorUserId: request.user!.id,
        targetUserId: request.user!.id,
        sourceType: "activity_assignment",
        sourceId: assignment.id,
        metadata: { templateCode: assignment.template.code, reason: reason ?? null },
        trace: request.trace
      });

      return ok(serializeAssignment({ ...assignment, ...skipped }));
    }
  );
}

async function loadRecentSkipReasons(
  server: FastifyInstance,
  userId: string
): Promise<ActivitySkipReason[]> {
  const events = await server.prisma.auditEvent.findMany({
    where: {
      actorUserId: userId,
      eventType: "activity.skipped"
    },
    orderBy: { createdAt: "desc" },
    take: 10
  });

  return events
    .map((event) => {
      const metadata = event.metadata;
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
        return null;
      }
      const reason = (metadata as { reason?: unknown }).reason;
      return typeof reason === "string" && activitySkipReasons.includes(reason as ActivitySkipReason)
        ? (reason as ActivitySkipReason)
        : null;
    })
    .filter((reason): reason is ActivitySkipReason => reason !== null);
}

type ActivityState = {
  template: ActivityTemplate;
  category: CanonicalActivityCategory;
  eligible: boolean;
  cooldownRemainingSeconds: number;
  completedCount: number;
  categoryCompletionCount: number;
  lastUsedAt: Date | null;
  lastCompletedAt: Date | null;
};

async function buildActivityStates(
  server: FastifyInstance,
  userId: string,
  templates: ActivityTemplate[],
  now: Date
): Promise<ActivityState[]> {
  const assignments = await server.prisma.activityAssignment.findMany({
    where: {
      userId,
      templateId: { in: templates.map((template) => template.id) }
    },
    orderBy: { assignedAt: "desc" }
  });

  const completedByCategory = assignments.reduce<Record<string, number>>((counts, assignment) => {
    if (assignment.status !== ActivityAssignmentStatus.completed) {
      return counts;
    }
    const template = templates.find((item) => item.id === assignment.templateId);
    if (!template) {
      return counts;
    }
    const category = normalizeActivityCategory(template.category);
    counts[category] = (counts[category] ?? 0) + 1;
    return counts;
  }, {});

  return templates.map((template) => {
    const templateAssignments = assignments.filter(
      (assignment) => assignment.templateId === template.id
    );
    const latest = templateAssignments[0];
    const latestTime = latest ? latest.completedAt ?? latest.assignedAt : null;
    const cooldownRemainingMilliseconds = latestTime
      ? Math.max(0, template.cooldownSeconds * 1000 - (now.getTime() - latestTime.getTime()))
      : 0;
    const category = normalizeActivityCategory(template.category);

    return {
      template,
      category,
      eligible: cooldownRemainingMilliseconds === 0,
      cooldownRemainingSeconds: Math.ceil(cooldownRemainingMilliseconds / 1000),
      completedCount: templateAssignments.filter(
        (assignment) => assignment.status === ActivityAssignmentStatus.completed
      ).length,
      categoryCompletionCount: completedByCategory[category] ?? 0,
      lastUsedAt: latestTime,
      lastCompletedAt:
        templateAssignments.find(
          (assignment) =>
            assignment.status === ActivityAssignmentStatus.completed && assignment.completedAt
        )?.completedAt ?? null
    };
  });
}

function serializeCatalogItem(state: ActivityState, now: Date) {
  const reward = toRewardConfig(state.template.rewardConfig);
  const interaction = buildActivityInteraction(state.template);
  const presentation = buildActivityPresentation(state.template);
  return {
    templateId: state.template.id,
    code: state.template.code,
    title: state.template.title,
    description: state.template.description,
    category: state.category,
    difficulty: state.template.difficulty,
    rewardPreview: {
      score: reward.score ?? 0,
      drawProgress: reward.drawProgress ?? 0
    },
    presentation,
    interactionSummary: summarizeActivityInteraction(interaction),
    eligible: state.eligible,
    cooldownRemainingSeconds: state.cooldownRemainingSeconds,
    completedCount: state.completedCount,
    lastCompletedAt: state.lastCompletedAt?.toISOString() ?? null,
    checkedAt: now.toISOString()
  };
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
    code: string;
    title: string;
    description: string;
    category: ActivityCategory;
    difficulty: ActivityDifficulty;
    rewardConfig: Prisma.JsonValue;
  };
}) {
  const reward = toRewardConfig(assignment.template.rewardConfig);
  const interaction = buildActivityInteraction(assignment.template);
  const presentation = buildActivityPresentation(assignment.template);
  return {
    assignmentId: assignment.id,
    code: assignment.template.code,
    title: assignment.template.title,
    description: assignment.template.description,
    category: normalizeActivityCategory(assignment.template.category),
    difficulty: assignment.template.difficulty,
    status: assignment.status,
    rewardPreview: {
      score: reward.score ?? 0,
      drawProgress: reward.drawProgress ?? 0
    },
    presentation,
    interaction,
    interactionSummary: summarizeActivityInteraction(interaction),
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
