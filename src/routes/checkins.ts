import { CheckInStatus, RewardSourceType, RewardType } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { recordAuditEventWithClient } from "../audit/events.js";
import { ok } from "../http/envelope.js";
import { rateLimitFor } from "../rate-limit/policies.js";
import { incrementLeaderboardScores } from "./leaderboards.js";

const checkInSessionSchema = {
  type: "object",
  required: ["id", "status", "startedAt"],
  properties: {
    id: { type: "string" },
    status: { type: "string" },
    startedAt: { type: "string" },
    endedAt: { type: ["string", "null"] },
    durationSeconds: { type: ["number", "null"] },
    eligibleDurationSeconds: { type: ["number", "null"] },
    rewarded: { type: "boolean" }
  }
} as const;

const errorEnvelopeSchema = {
  type: "object",
  required: ["data", "error"],
  properties: {
    data: { type: "null" },
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        requestId: { type: "string" },
        traceId: { type: "string" }
      }
    }
  }
} as const;

export async function registerCheckInRoutes(server: FastifyInstance) {
  server.get(
    "/v1/check-ins/active",
    {
      ...rateLimitFor(server, "checkIns"),
      preHandler: [server.requireAuth],
      schema: {
        response: {
          200: {
            type: "object",
            required: ["data", "error"],
            properties: {
              data: {
                anyOf: [checkInSessionSchema, { type: "null" }]
              },
              error: { type: "null" }
            }
          }
        }
      }
    },
    async (request) => {
      const session = await server.prisma.checkInSession.findFirst({
        where: {
          userId: request.user?.id,
          status: CheckInStatus.active
        },
        orderBy: { startedAt: "desc" }
      });

      return ok(session ? serializeSession(session) : null);
    }
  );

  server.post(
    "/v1/check-ins",
    {
      ...rateLimitFor(server, "checkIns"),
      preHandler: [server.requireAuth],
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            idempotencyKey: { type: "string", minLength: 8, maxLength: 128 }
          }
        },
        response: {
          200: {
            type: "object",
            required: ["data", "error"],
            properties: {
              data: checkInSessionSchema,
              error: { type: "null" }
            }
          },
          409: {
            type: "object",
            required: ["data", "error"],
            properties: {
              data: checkInSessionSchema,
              error: {
                type: "object",
                required: ["code", "message"],
                properties: {
                  code: { type: "string" },
                  message: { type: "string" },
                  requestId: { type: "string" },
                  traceId: { type: "string" }
                }
              }
            }
          }
        }
      }
    },
    async (request, reply) => {
      const body = request.body as { idempotencyKey?: string } | undefined;
      const active = await server.prisma.checkInSession.findFirst({
        where: {
          userId: request.user?.id,
          status: CheckInStatus.active
        }
      });

      if (active) {
        return reply.code(409).send({
          data: serializeSession(active),
          error: {
            code: "ACTIVE_CHECK_IN_EXISTS",
            message: "An active check-in already exists",
            requestId: request.trace.requestId,
            traceId: request.trace.traceId
          }
        });
      }

      const session = await server.prisma.checkInSession.create({
        data: {
          userId: request.user!.id,
          startedAt: new Date(),
          status: CheckInStatus.active,
          idempotencyKey: body?.idempotencyKey
        }
      });

      await recordAuditEventWithClient(server.prisma, {
        eventType: "check_in.started",
        actorUserId: request.user!.id,
        targetUserId: request.user!.id,
        sourceType: "check_in_session",
        sourceId: session.id,
        metadata: { status: session.status },
        trace: request.trace
      });

      return ok(serializeSession(session));
    }
  );

  server.post(
    "/v1/check-ins/:id/finish",
    {
      ...rateLimitFor(server, "checkIns"),
      preHandler: [server.requireAuth],
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", format: "uuid" }
          }
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            idempotencyKey: { type: "string", minLength: 8, maxLength: 128 }
          }
        },
        response: {
          404: errorEnvelopeSchema
        }
      }
    },
    async (request, reply) => {
      const params = request.params as { id: string };
      const now = new Date();
      const rules = server.runtimeConfig.checkIns;

      const session = await server.prisma.checkInSession.findUnique({
        where: { id: params.id }
      });

      if (!session || session.userId !== request.user?.id) {
        return reply.code(404).send({
          data: null,
          error: {
            code: "CHECK_IN_NOT_FOUND",
            message: "Check-in session not found",
            requestId: request.trace.requestId,
            traceId: request.trace.traceId
          }
        });
      }

      if (session.status !== CheckInStatus.active) {
        return ok({
          session: serializeSession(session),
          reward: { score: 0, drawProgress: 0, rewarded: session.rewarded }
        });
      }

      const rawDurationSeconds = Math.max(
        0,
        Math.floor((now.getTime() - session.startedAt.getTime()) / 1000)
      );
      const cappedDurationSeconds = Math.min(rawDurationSeconds, rules.maxSessionSeconds);
      const eligibleDurationSeconds =
        cappedDurationSeconds >= rules.minRewardDurationSeconds ? cappedDurationSeconds : 0;
      const dailyRewardCount = await countTodayRewardedSessions(server, request.user!.id, now);
      const dailyCapReached = dailyRewardCount >= rules.dailyRewardedSessionCap;
      const rewarded = eligibleDurationSeconds > 0 && !dailyCapReached;
      const score = rewarded
        ? Math.max(1, Math.floor(eligibleDurationSeconds / 60) * rules.scorePerEligibleMinute)
        : 0;
      const drawProgress = rewarded ? rules.drawProgressPerSession : 0;
      const status =
        rawDurationSeconds > rules.maxSessionSeconds
          ? CheckInStatus.invalidated
          : CheckInStatus.completed;
      const invalidReason =
        rawDurationSeconds > rules.maxSessionSeconds
          ? "MAX_DURATION_EXCEEDED"
          : dailyCapReached
            ? "DAILY_REWARD_CAP_REACHED"
            : eligibleDurationSeconds === 0
              ? "BELOW_MIN_REWARD_DURATION"
              : undefined;

      const finished = await server.prisma.$transaction(async (tx) => {
        const existingStats = await tx.userStats.findUnique({
          where: { userId: request.user!.id }
        });
        const streak = nextStreak(existingStats, rewarded, now);
        const updated = await tx.checkInSession.update({
          where: { id: session.id },
          data: {
            endedAt: now,
            durationSeconds: rawDurationSeconds,
            eligibleDurationSeconds,
            status,
            invalidReason,
            rewarded
          }
        });

        await tx.userStats.upsert({
          where: { userId: request.user!.id },
          create: {
            userId: request.user!.id,
            totalSessions: 1,
            totalDurationSeconds: rawDurationSeconds,
            eligibleDurationSeconds,
            currentStreakDays: rewarded ? 1 : 0,
            longestStreakDays: rewarded ? 1 : 0,
            lastEligibleCheckinDate: rewarded ? todayUtc(now) : undefined,
            drawProgress
          },
          update: {
            totalSessions: { increment: 1 },
            totalDurationSeconds: { increment: rawDurationSeconds },
            eligibleDurationSeconds: { increment: eligibleDurationSeconds },
            currentStreakDays: streak.currentStreakDays,
            longestStreakDays: streak.longestStreakDays,
            drawProgress: { increment: drawProgress },
            lastEligibleCheckinDate: rewarded ? todayUtc(now) : undefined
          }
        });

        if (rewarded) {
          await tx.rewardLedger.createMany({
            data: [
              {
                userId: request.user!.id,
                sourceType: RewardSourceType.check_in,
                sourceId: session.id,
                rewardType: RewardType.score,
                amount: score,
                metadata: rewardMetadata(request, eligibleDurationSeconds)
              },
              {
                userId: request.user!.id,
                sourceType: RewardSourceType.check_in,
                sourceId: session.id,
                rewardType: RewardType.draw_progress,
                amount: drawProgress,
                metadata: rewardMetadata(request, eligibleDurationSeconds)
              }
            ]
          });
          await incrementLeaderboardScores(tx, {
            userId: request.user!.id,
            score,
            now
          });
        }

        return updated;
      });

      await recordAuditEventWithClient(server.prisma, {
        eventType: "check_in.finished",
        actorUserId: request.user!.id,
        targetUserId: request.user!.id,
        sourceType: "check_in_session",
        sourceId: session.id,
        metadata: {
          rawDurationSeconds,
          eligibleDurationSeconds,
          status,
          invalidReason,
          reward: { score, drawProgress, rewarded }
        },
        trace: request.trace
      });

      if (rewarded) {
        await recordAuditEventWithClient(server.prisma, {
          eventType: "leaderboard.projected",
          actorUserId: request.user!.id,
          targetUserId: request.user!.id,
          sourceType: "check_in_session",
          sourceId: session.id,
          metadata: {
            windows: ["daily", "weekly", "monthly", "all_time"],
            score
          },
          trace: request.trace
        });
      }

      return ok({
        session: serializeSession(finished),
        reward: { score, drawProgress, rewarded }
      });
    }
  );
}

function serializeSession(session: {
  id: string;
  status: CheckInStatus;
  startedAt: Date;
  endedAt: Date | null;
  durationSeconds: number | null;
  eligibleDurationSeconds: number | null;
  rewarded: boolean;
}) {
  return {
    id: session.id,
    status: session.status,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
    durationSeconds: session.durationSeconds,
    eligibleDurationSeconds: session.eligibleDurationSeconds,
    rewarded: session.rewarded
  };
}

async function countTodayRewardedSessions(
  server: FastifyInstance,
  userId: string,
  now: Date
): Promise<number> {
  const start = todayUtc(now);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  return server.prisma.checkInSession.count({
    where: {
      userId,
      rewarded: true,
      endedAt: {
        gte: start,
        lt: end
      }
    }
  });
}

function todayUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function nextStreak(
  stats:
    | {
        currentStreakDays: number;
        longestStreakDays: number;
        lastEligibleCheckinDate: Date | null;
      }
    | null,
  rewarded: boolean,
  now: Date
) {
  if (!rewarded) {
    return {
      currentStreakDays: stats?.currentStreakDays ?? 0,
      longestStreakDays: stats?.longestStreakDays ?? 0
    };
  }

  const today = todayUtc(now);
  const last = stats?.lastEligibleCheckinDate ? todayUtc(stats.lastEligibleCheckinDate) : null;
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  const currentStreakDays =
    last?.getTime() === today.getTime()
      ? stats?.currentStreakDays ?? 1
      : last?.getTime() === yesterday.getTime()
        ? (stats?.currentStreakDays ?? 0) + 1
        : 1;

  return {
    currentStreakDays,
    longestStreakDays: Math.max(currentStreakDays, stats?.longestStreakDays ?? 0)
  };
}

function rewardMetadata(
  request: { trace: { requestId: string; traceId: string; spanId: string } },
  eligibleDurationSeconds: number
) {
  return {
    requestId: request.trace.requestId,
    traceId: request.trace.traceId,
    spanId: request.trace.spanId,
    eligibleDurationSeconds
  };
}
