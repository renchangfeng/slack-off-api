import {
  ActivityAssignmentStatus,
  ActivityFeedbackSource,
  ActivityFeedbackType,
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
  buildExistingLoopAuditMetadata,
  grantExistingLoopRewards,
  reconstructExistingLoopOutcomes,
  resolveExistingLoopOutcomes
} from "../fish-tank/resources.js";
import {
  buildActivityInteraction,
  buildActivityPresentation,
  pickCompletionFeedback,
  summarizeActivityInteraction,
  summarizeCompletedSteps,
  validateActivityInteractionProgress,
  type ActivityInteractionProgress,
  type ActivityPresentation
} from "../activities/interaction.js";
import {
  canonicalActivityCategories,
  activitySkipReasons,
  explainActivityRecommendation,
  isActivityFlavor,
  isCanonicalActivityCategory,
  normalizeActivityCategory,
  recommendActivity,
  type ActivityFeedbackSignal,
  type ActivityFlavor,
  type ActivitySkipReason,
  type CanonicalActivityCategory
} from "../activities/recommendation.js";
import { fail, ok } from "../http/envelope.js";
import { rateLimitFor } from "../rate-limit/policies.js";
import { incrementLeaderboardScores } from "./leaderboards.js";

const activityFeedbackTypes = [
  ActivityFeedbackType.liked,
  ActivityFeedbackType.neutral,
  ActivityFeedbackType.dislike_similar,
  ActivityFeedbackType.want_weirder,
  ActivityFeedbackType.too_much_work,
  ActivityFeedbackType.too_long,
  ActivityFeedbackType.too_physical,
  ActivityFeedbackType.shorter
] as const;

const activityFeedbackSources = [
  ActivityFeedbackSource.completion,
  ActivityFeedbackSource.skip
] as const;

type ActivityFeedbackResponse = {
  acknowledgement: string;
  event: {
    id: string;
    assignmentId: string | null;
    templateId: string;
    category: CanonicalActivityCategory;
    feedbackType: ActivityFeedbackType;
    feedbackSource: ActivityFeedbackSource;
    skipReason: ActivitySkipReason | null;
    createdAt: string;
  };
};

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
            window: { type: "string", enum: ["today", "recent"], default: "recent" },
            limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
            cursor: { type: "string" }
          }
        }
      }
    },
    async (request) => {
      const query = request.query as {
        window?: ActivityHistoryWindow;
        limit?: number;
        cursor?: string;
      };
      const window = query.window ?? "recent";
      const limit = query.limit ?? 20;
      const cursor = parseHistoryCursor(query.cursor);
      const now = new Date();
      const where: Prisma.ActivityAssignmentWhereInput = {
        userId: request.user!.id,
        status: {
          in: [
            ActivityAssignmentStatus.completed,
            ActivityAssignmentStatus.expired,
            ActivityAssignmentStatus.skipped
          ]
        }
      };
      if (window === "today") {
        const { start, end } = utcDayRange(now);
        where.OR = [
          { completedAt: { gte: start, lt: end } },
          {
            completedAt: null,
            assignedAt: { gte: start, lt: end }
          }
        ];
      }
      if (cursor) {
        const cursorFilter: Prisma.ActivityAssignmentWhereInput[] = [
          { assignedAt: { lt: cursor.assignedAt } },
          { assignedAt: cursor.assignedAt, id: { lt: cursor.id } }
        ];
        where.AND = [{ OR: cursorFilter }];
      }

      const assignments = await server.prisma.activityAssignment.findMany({
        where,
        orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        include: { template: true }
      });

      const hasMore = assignments.length > limit;
      const items = hasMore ? assignments.slice(0, limit) : assignments;
      const nextCursor = hasMore ? buildHistoryCursor(items[items.length - 1]) : null;
      const feedbackByAssignment = await loadFeedbackForAssignments(
        server,
        request.user!.id,
        items.map((assignment) => assignment.id)
      );

      return ok({
        items: items.map((assignment) =>
          serializeHistorySession(assignment, feedbackByAssignment.get(assignment.id) ?? [])
        ),
        nextCursor
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
      const body = (request.body ?? {}) as {
        category?: string;
        replayHint?: ActivityReplayHintInput;
      };
      if (body.category && !isCanonicalActivityCategory(body.category)) {
        return reply
          .code(400)
          .send(fail("INVALID_ACTIVITY_CATEGORY", "Invalid activity category", request.trace));
      }
      const preferredCategory = isCanonicalActivityCategory(body.category)
        ? body.category
        : undefined;
      const replayHint = body.replayHint
        ? await resolveReplayHint(server, request.user!.id, body.replayHint)
        : null;
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
      const feedbackSignals = await loadRecentFeedbackSignals(server, request.user!.id, now);
      const recommendation = recommendActivity(states.map((state) => ({
        value: state.template,
        category: state.category,
        eligible: state.eligible,
        difficulty: state.template.difficulty,
        flavor: flavorForTemplate(state.template),
        interactionSummary: summarizeActivityInteraction(buildActivityInteraction(state.template)),
        completedCount: state.completedCount,
        categoryCompletionCount: state.categoryCompletionCount,
        lastUsedAt: state.lastUsedAt
      })), {
        preferredCategory: replayHint?.preferredCategory ?? preferredCategory,
        preferredFlavor: replayHint?.preferredFlavor,
        excludeTemplateId: replayHint?.excludeTemplateId,
        recentSkipReasons,
        feedbackSignals,
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
          preferredCategory: replayHint?.preferredCategory ?? preferredCategory ?? null,
          preferredFlavor: replayHint?.preferredFlavor ?? null,
          sourceAssignmentId: replayHint?.sourceAssignmentId ?? null,
          recommendationReason: recommendation.reason,
          recommendationExplanation: explainActivityRecommendation({
            reason: recommendation.reason,
            preferredCategory: replayHint?.preferredCategory ?? preferredCategory,
            flavor: recommendation.flavor,
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
          preferredCategory: replayHint?.preferredCategory ?? preferredCategory,
          flavor: recommendation.flavor,
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
      const fishTankPolicy = server.runtimeConfig.fishTank.existingLoopRewards;
      const assignment = await server.prisma.activityAssignment.findUnique({
        where: { id: params.assignmentId },
        include: { template: true }
      });

      if (!assignment || assignment.userId !== request.user?.id) {
        await recordAuditEventWithClient(server.prisma, {
          eventType: "fish_tank.existing_loop.rejected",
          actorUserId: request.user!.id,
          targetUserId: request.user!.id,
          sourceType: "activity_assignment",
          sourceId: params.assignmentId,
          metadata: buildExistingLoopAuditMetadata({
            sourceType: "activity_completion",
            sourceId: params.assignmentId,
            policyVersion: fishTankPolicy.policyVersion,
            outcome: "rejected",
            reason: "ACTIVITY_NOT_FOUND"
          }),
          trace: request.trace
        });
        return reply
          .code(404)
          .send(fail("ACTIVITY_NOT_FOUND", "Activity assignment not found", request.trace));
      }

      if (assignment.status !== ActivityAssignmentStatus.active) {
        const fishTankOutcomes = await reconstructExistingLoopOutcomes(server.prisma, request.user!.id, {
          sourceType: "activity_completion",
          sourceId: assignment.id
        });
        await recordAuditEventWithClient(server.prisma, {
          eventType:
            fishTankOutcomes.length > 0
              ? "fish_tank.existing_loop.replayed"
              : "fish_tank.existing_loop.empty",
          actorUserId: request.user!.id,
          targetUserId: request.user!.id,
          sourceType: "activity_assignment",
          sourceId: assignment.id,
          metadata: buildExistingLoopAuditMetadata({
            sourceType: "activity_completion",
            sourceId: assignment.id,
            policyVersion: fishTankPolicy.policyVersion,
            outcome: fishTankOutcomes.length > 0 ? "replayed" : "empty",
            outcomes: fishTankOutcomes,
            reason: assignment.rewarded ? undefined : "ALREADY_COMPLETED"
          }),
          trace: request.trace
        });
        return ok({
          assignment: serializeAssignment(assignment),
          reward: {
            score: 0,
            drawProgress: 0,
            drawChancesGranted: 0,
            rewarded: assignment.rewarded,
            reason: "ALREADY_COMPLETED",
            achievementsUnlocked: []
          },
          fishTankOutcomes
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
        await recordAuditEventWithClient(server.prisma, {
          eventType: "fish_tank.existing_loop.rejected",
          actorUserId: request.user!.id,
          targetUserId: request.user!.id,
          sourceType: "activity_assignment",
          sourceId: assignment.id,
          metadata: buildExistingLoopAuditMetadata({
            sourceType: "activity_completion",
            sourceId: assignment.id,
            policyVersion: fishTankPolicy.policyVersion,
            outcome: "rejected",
            reason: "ACTIVITY_EXPIRED"
          }),
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
        await recordAuditEventWithClient(server.prisma, {
          eventType: "fish_tank.existing_loop.rejected",
          actorUserId: request.user!.id,
          targetUserId: request.user!.id,
          sourceType: "activity_assignment",
          sourceId: assignment.id,
          metadata: buildExistingLoopAuditMetadata({
            sourceType: "activity_completion",
            sourceId: assignment.id,
            policyVersion: fishTankPolicy.policyVersion,
            outcome: "rejected",
            reason: "INTERACTION_INCOMPLETE"
          }),
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
      const plannedFishOutcomes = !dailyLimitReached
        ? resolveExistingLoopOutcomes("activity_completion", fishTankPolicy)
        : [];
      let drawChancesGranted = 0;
      const reward = await server.prisma.$transaction(async (tx) => {
        const claimed = await tx.activityAssignment.updateMany({
          where: {
            id: assignment.id,
            userId: request.user!.id,
            status: ActivityAssignmentStatus.active
          },
          data: {
            status: ActivityAssignmentStatus.completed,
            completedAt: now,
            rewarded: !dailyLimitReached
          }
        });
        if (claimed.count === 0) {
          return { concurrentReplay: true as const };
        }

        if (dailyLimitReached) {
          return {
            concurrentReplay: false as const,
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

        await grantExistingLoopRewards(tx, request.user!.id, {
          sourceType: "activity_completion",
          sourceId: assignment.id,
          policyVersion: fishTankPolicy.policyVersion,
          outcomes: plannedFishOutcomes,
          requestId: request.trace.requestId,
          traceId: request.trace.traceId
        });

        return {
          concurrentReplay: false as const,
          score: rewardConfig.score ?? 0,
          drawProgress: rewardConfig.drawProgress ?? 0,
          drawChancesGranted: draw.chancesGranted,
          rewarded: true,
          reason: null
        };
      }).catch(async (error) => {
        await recordAuditEventWithClient(server.prisma, {
          eventType: "fish_tank.existing_loop.rolled_back",
          actorUserId: request.user!.id,
          targetUserId: request.user!.id,
          sourceType: "activity_assignment",
          sourceId: assignment.id,
          metadata: buildExistingLoopAuditMetadata({
            sourceType: "activity_completion",
            sourceId: assignment.id,
            policyVersion: fishTankPolicy.policyVersion,
            outcome: "rolled_back",
            outcomes: plannedFishOutcomes,
            reason: error instanceof Error ? error.name : "UNKNOWN_ERROR"
          }),
          trace: request.trace
        });
        throw error;
      });

      if (reward.concurrentReplay) {
        const replayedAssignment = await server.prisma.activityAssignment.findUnique({
          where: { id: assignment.id },
          include: { template: true }
        });
        const fishTankOutcomes = await reconstructExistingLoopOutcomes(
          server.prisma,
          request.user!.id,
          {
            sourceType: "activity_completion",
            sourceId: assignment.id
          }
        );
        await recordAuditEventWithClient(server.prisma, {
          eventType:
            fishTankOutcomes.length > 0
              ? "fish_tank.existing_loop.replayed"
              : "fish_tank.existing_loop.empty",
          actorUserId: request.user!.id,
          targetUserId: request.user!.id,
          sourceType: "activity_assignment",
          sourceId: assignment.id,
          metadata: buildExistingLoopAuditMetadata({
            sourceType: "activity_completion",
            sourceId: assignment.id,
            policyVersion: fishTankPolicy.policyVersion,
            outcome: fishTankOutcomes.length > 0 ? "replayed" : "empty",
            outcomes: fishTankOutcomes,
            reason: "CONCURRENT_REPLAY"
          }),
          trace: request.trace
        });
        const currentAssignment = replayedAssignment ?? assignment;
        return ok({
          assignment: serializeAssignment(currentAssignment),
          reward: {
            score: 0,
            drawProgress: 0,
            drawChancesGranted: 0,
            rewarded: currentAssignment.rewarded,
            reason: "ALREADY_COMPLETED",
            achievementsUnlocked: []
          },
          fishTankOutcomes
        });
      }

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

      const fishOutcome =
        reward.rewarded && plannedFishOutcomes.length > 0 ? "granted" : "empty";
      await recordAuditEventWithClient(server.prisma, {
        eventType: `fish_tank.existing_loop.${fishOutcome}`,
        actorUserId: request.user!.id,
        targetUserId: request.user!.id,
        sourceType: "activity_assignment",
        sourceId: assignment.id,
        metadata: buildExistingLoopAuditMetadata({
          sourceType: "activity_completion",
          sourceId: assignment.id,
          policyVersion: fishTankPolicy.policyVersion,
          outcome: fishOutcome,
          outcomes: plannedFishOutcomes,
          reason: reward.rewarded ? (fishOutcome === "empty" ? "POLICY_EMPTY" : undefined) : "DAILY_LIMIT_REACHED"
        }),
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
          score: reward.score,
          drawProgress: reward.drawProgress,
          drawChancesGranted: reward.drawChancesGranted,
          rewarded: reward.rewarded,
          reason: reward.reason,
          achievementsUnlocked
        },
        feedback: pickCompletionFeedback(interaction, assignment.id),
        resultTitle: interaction.resultSummary.title,
        resultCopy: interaction.resultSummary.copy,
        stepSummaries: summarizeCompletedSteps(interaction, body.interaction),
        fishTankOutcomes: plannedFishOutcomes
      });
    }
  );

  server.post(
    "/v1/activities/:assignmentId/feedback",
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
          required: ["feedbackType", "source"],
          properties: {
            feedbackType: { type: "string", enum: activityFeedbackTypes },
            source: { type: "string", enum: activityFeedbackSources }
          }
        }
      }
    },
    async (request, reply) => {
      const params = request.params as { assignmentId: string };
      const body = request.body as {
        feedbackType: ActivityFeedbackType;
        source: ActivityFeedbackSource;
      };
      const assignment = await server.prisma.activityAssignment.findUnique({
        where: { id: params.assignmentId },
        include: { template: true }
      });

      if (!assignment || assignment.userId !== request.user?.id) {
        return reply
          .code(404)
          .send(fail("ACTIVITY_NOT_FOUND", "Activity assignment not found", request.trace));
      }

      if (
        assignment.status !== ActivityAssignmentStatus.completed &&
        assignment.status !== ActivityAssignmentStatus.skipped
      ) {
        return reply
          .code(409)
          .send(fail("ACTIVITY_FEEDBACK_NOT_READY", "Feedback is only available after completion or skip", request.trace));
      }

      if (
        (assignment.status === ActivityAssignmentStatus.completed && body.source !== ActivityFeedbackSource.completion) ||
        (assignment.status === ActivityAssignmentStatus.skipped && body.source !== ActivityFeedbackSource.skip)
      ) {
        return reply
          .code(400)
          .send(fail("ACTIVITY_FEEDBACK_SOURCE_MISMATCH", "Feedback source does not match assignment status", request.trace));
      }

      const response = await saveActivityFeedbackEvent(server, {
        userId: request.user!.id,
        assignment,
        feedbackType: body.feedbackType,
        feedbackSource: body.source,
        skipReason: null,
        trace: request.trace
      });

      return ok(response);
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

      if (reason) {
        await saveActivityFeedbackEvent(server, {
          userId: request.user!.id,
          assignment: { ...assignment, ...skipped },
          feedbackType: feedbackTypeForSkipReason(reason, assignment),
          feedbackSource: ActivityFeedbackSource.skip,
          skipReason: reason,
          trace: request.trace
        });
      }

      return ok(serializeAssignment({ ...assignment, ...skipped }));
    }
  );
}

function flavorForTemplate(template: ActivityTemplate) {
  const flavor = (template.rewardConfig as { flavor?: string }).flavor;
  return isActivityFlavor(flavor) ? flavor : undefined;
}

async function saveActivityFeedbackEvent(
  server: FastifyInstance,
  input: {
    userId: string;
    assignment: {
      id: string;
      templateId: string;
      template: ActivityTemplate;
    };
    feedbackType: ActivityFeedbackType;
    feedbackSource: ActivityFeedbackSource;
    skipReason: ActivitySkipReason | null;
    trace: { requestId: string; traceId: string; spanId: string };
  }
): Promise<ActivityFeedbackResponse> {
  const interaction = buildActivityInteraction(input.assignment.template);
  const summary = summarizeActivityInteraction(interaction);
  const event = await server.prisma.activityFeedbackEvent.upsert({
    where: {
      userId_assignmentId_feedbackType_feedbackSource: {
        userId: input.userId,
        assignmentId: input.assignment.id,
        feedbackType: input.feedbackType,
        feedbackSource: input.feedbackSource
      }
    },
    create: {
      userId: input.userId,
      assignmentId: input.assignment.id,
      templateId: input.assignment.templateId,
      category: input.assignment.template.category,
      feedbackType: input.feedbackType,
      feedbackSource: input.feedbackSource,
      skipReason: input.skipReason,
      interactionTypes: interaction.steps.map((step) => step.type),
      metadata: {
        templateCode: input.assignment.template.code,
        difficulty: input.assignment.template.difficulty,
        flavor: flavorForTemplate(input.assignment.template),
        interactionSummary: summary,
        requestId: input.trace.requestId,
        traceId: input.trace.traceId,
        spanId: input.trace.spanId
      }
    },
    update: {}
  });

  return serializeFeedbackEvent(event, acknowledgementForFeedback(input.feedbackType));
}

function serializeFeedbackEvent(
  event: {
    id: string;
    assignmentId: string | null;
    templateId: string;
    category: ActivityCategory;
    feedbackType: ActivityFeedbackType;
    feedbackSource: ActivityFeedbackSource;
    skipReason: string | null;
    createdAt: Date;
  },
  acknowledgement: string
): ActivityFeedbackResponse {
  return {
    acknowledgement,
    event: {
      id: event.id,
      assignmentId: event.assignmentId,
      templateId: event.templateId,
      category: normalizeActivityCategory(event.category),
      feedbackType: event.feedbackType,
      feedbackSource: event.feedbackSource,
      skipReason: activitySkipReasons.includes(event.skipReason as ActivitySkipReason)
        ? (event.skipReason as ActivitySkipReason)
        : null,
      createdAt: event.createdAt.toISOString()
    }
  };
}

function acknowledgementForFeedback(feedbackType: ActivityFeedbackType): string {
  return {
    [ActivityFeedbackType.liked]: "收到，下次多安排这种手感的摸鱼。",
    [ActivityFeedbackType.neutral]: "收到，保持轻量，不打扰你继续摸鱼。",
    [ActivityFeedbackType.dislike_similar]: "收到，近期会少推荐类似任务。",
    [ActivityFeedbackType.want_weirder]: "收到，下次可以稍微怪一点。",
    [ActivityFeedbackType.too_much_work]: "收到，下次尽量轻一点。",
    [ActivityFeedbackType.too_long]: "收到，下次优先短一点。",
    [ActivityFeedbackType.too_physical]: "收到，下次少安排需要动太多的任务。",
    [ActivityFeedbackType.shorter]: "收到，下次优先更短的摸鱼。"
  }[feedbackType];
}

function feedbackTypeForSkipReason(
  reason: ActivitySkipReason,
  assignment: { template: ActivityTemplate }
): ActivityFeedbackType {
  if (reason === "too_much_work") {
    return ActivityFeedbackType.too_much_work;
  }
  if (reason === "not_interested") {
    return ActivityFeedbackType.dislike_similar;
  }
  if (reason === "want_weirder") {
    return ActivityFeedbackType.want_weirder;
  }
  if (reason === "not_convenient") {
    const interaction = summarizeActivityInteraction(buildActivityInteraction(assignment.template));
    return normalizeActivityCategory(assignment.template.category) === "physical" || interaction.hasTimer
      ? ActivityFeedbackType.too_physical
      : ActivityFeedbackType.too_long;
  }
  return ActivityFeedbackType.neutral;
}
async function loadRecentFeedbackSignals(
  server: FastifyInstance,
  userId: string,
  now: Date
): Promise<ActivityFeedbackSignal[]> {
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const events = await server.prisma.activityFeedbackEvent.findMany({
    where: {
      userId,
      createdAt: { gte: since }
    },
    orderBy: { createdAt: "desc" },
    take: 50
  });

  return events.map((event) => {
    const metadata = event.metadata as { flavor?: string } | null;
    const flavor = metadata?.flavor;
    return {
      templateId: event.templateId,
      category: normalizeActivityCategory(event.category),
      flavor: isActivityFlavor(flavor) ? flavor : undefined,
      feedbackType: event.feedbackType,
      createdAt: event.createdAt
    };
  });
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

type ActivityHistoryWindow = "today" | "recent";

type ActivityReplayHintInput = {
  sourceAssignmentId?: string;
  preferredCategory?: string;
  preferredFlavor?: string;
  excludeTemplateId?: string;
};

type HistoryCursor = {
  assignedAt: Date;
  id: string;
};

function parseHistoryCursor(cursor: string | undefined): HistoryCursor | null {
  if (!cursor) return null;
  const separatorIndex = cursor.lastIndexOf("|");
  if (separatorIndex === -1) return null;
  const assignedAtPart = cursor.slice(0, separatorIndex);
  const idPart = cursor.slice(separatorIndex + 1);
  const assignedAt = Date.parse(assignedAtPart);
  if (Number.isNaN(assignedAt) || !idPart) return null;
  return { assignedAt: new Date(assignedAt), id: idPart };
}

function buildHistoryCursor(assignment: { assignedAt: Date; id: string }): string {
  return `${assignment.assignedAt.toISOString()}|${assignment.id}`;
}

function utcDayRange(now: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

async function loadFeedbackForAssignments(
  server: FastifyInstance,
  userId: string,
  assignmentIds: string[]
): Promise<Map<string, ActivityFeedbackEventWithAck[]>> {
  if (assignmentIds.length === 0) {
    return new Map();
  }
  const events = await server.prisma.activityFeedbackEvent.findMany({
    where: {
      userId,
      assignmentId: { in: assignmentIds }
    }
  });
  const map = new Map<string, ActivityFeedbackEventWithAck[]>();
  for (const event of events) {
    if (!event.assignmentId) continue;
    const list = map.get(event.assignmentId) ?? [];
    list.push({
      id: event.id,
      assignmentId: event.assignmentId,
      templateId: event.templateId,
      category: event.category,
      feedbackType: event.feedbackType,
      feedbackSource: event.feedbackSource,
      skipReason: activitySkipReasons.includes(event.skipReason as ActivitySkipReason)
        ? (event.skipReason as ActivitySkipReason)
        : null,
      createdAt: event.createdAt,
      acknowledgement: acknowledgementForFeedback(event.feedbackType)
    });
    map.set(event.assignmentId, list);
  }
  return map;
}

type ActivityFeedbackEventWithAck = {
  id: string;
  assignmentId: string;
  templateId: string;
  category: ActivityCategory;
  feedbackType: ActivityFeedbackType;
  feedbackSource: ActivityFeedbackSource;
  skipReason: ActivitySkipReason | null;
  createdAt: Date;
  acknowledgement: string;
};

function findRelevantFeedback(
  events: ActivityFeedbackEventWithAck[],
  status: ActivityAssignmentStatus
): ActivityFeedbackEventWithAck | null {
  const source =
    status === ActivityAssignmentStatus.skipped
      ? ActivityFeedbackSource.skip
      : ActivityFeedbackSource.completion;
  return events.find((event) => event.feedbackSource === source) ?? events[0] ?? null;
}

function serializeHistorySession(
  assignment: {
    id: string;
    status: ActivityAssignmentStatus;
    assignedAt: Date;
    completedAt: Date | null;
    expiresAt: Date | null;
    rewarded: boolean;
    template: ActivityTemplate;
  },
  feedbackEvents: ActivityFeedbackEventWithAck[]
) {
  const reward = toRewardConfig(assignment.template.rewardConfig);
  const interaction = buildActivityInteraction(assignment.template);
  const presentation = buildActivityPresentation(assignment.template);
  const flavor = flavorForTemplate(assignment.template);
  const feedback = findRelevantFeedback(feedbackEvents, assignment.status);
  const skipReason =
    assignment.status === ActivityAssignmentStatus.skipped
      ? (feedback?.skipReason ?? null)
      : null;

  return {
    assignmentId: assignment.id,
    templateId: assignment.template.id,
    code: assignment.template.code,
    title: assignment.template.title,
    description: assignment.template.description,
    category: normalizeActivityCategory(assignment.template.category),
    difficulty: assignment.template.difficulty,
    status: assignment.status,
    flavor,
    presentation,
    rewardSummary: {
      score: reward.score ?? 0,
      drawProgress: reward.drawProgress ?? 0,
      rewarded: assignment.rewarded
    },
    assignedAt: assignment.assignedAt.toISOString(),
    completedAt: assignment.completedAt?.toISOString() ?? null,
    sessionAt: (assignment.completedAt ?? assignment.assignedAt).toISOString(),
    skipReason,
    feedback: feedback
      ? {
          type: feedback.feedbackType,
          acknowledgement: feedback.acknowledgement
        }
      : null,
    replayHint: {
      sourceAssignmentId: assignment.id,
      sourceTemplateId: assignment.template.id,
      preferredCategory: normalizeActivityCategory(assignment.template.category),
      preferredFlavor: flavor,
      excludeTemplateId: assignment.template.id
    }
  };
}

async function resolveReplayHint(
  server: FastifyInstance,
  userId: string,
  input: ActivityReplayHintInput
): Promise<
  | {
      sourceAssignmentId: string;
      preferredCategory?: CanonicalActivityCategory;
      preferredFlavor?: ActivityFlavor;
      excludeTemplateId?: string;
    }
  | null
> {
  let sourceAssignmentId = input.sourceAssignmentId;
  let preferredCategory: CanonicalActivityCategory | undefined = isCanonicalActivityCategory(
    input.preferredCategory ?? ""
  )
    ? (input.preferredCategory as CanonicalActivityCategory)
    : undefined;
  let preferredFlavor: ActivityFlavor | undefined = isActivityFlavor(input.preferredFlavor ?? "")
    ? (input.preferredFlavor as ActivityFlavor)
    : undefined;
  let excludeTemplateId = input.excludeTemplateId;

  if (sourceAssignmentId) {
    const assignment = await server.prisma.activityAssignment.findUnique({
      where: { id: sourceAssignmentId },
      include: { template: true }
    });
    if (assignment && assignment.userId === userId) {
      preferredCategory ??= normalizeActivityCategory(assignment.template.category);
      const flavor = flavorForTemplate(assignment.template);
      if (flavor) {
        preferredFlavor ??= flavor;
      }
      excludeTemplateId ??= assignment.template.id;
    }
  }

  if (!preferredCategory && !preferredFlavor && !excludeTemplateId) {
    return null;
  }

  return {
    sourceAssignmentId: sourceAssignmentId ?? "",
    preferredCategory,
    preferredFlavor,
    excludeTemplateId
  };
}

function toRewardConfig(value: Prisma.JsonValue): RewardConfig {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}
