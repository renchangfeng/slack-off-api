import type { FastifyInstance } from "fastify";
import { recordAuditEventWithClient } from "../audit/events.js";
import { fail, ok } from "../http/envelope.js";
import { rateLimitFor } from "../rate-limit/policies.js";
import { FishTankResourceError } from "../fish-tank/resources.js";
import {
  FishTankError,
  getTankSummary,
  initializeTank,
  performCareInteraction,
  performHatch,
  type CareInteractionInput,
  type HatchInput
} from "../fish-tank/service.js";

export async function registerFishTankRoutes(server: FastifyInstance) {
  server.get(
    "/v1/fish-tank",
    {
      ...rateLimitFor(server, "fishTank"),
      preHandler: [server.requireAuth]
    },
    async (request) => {
      const summary = await getTankSummary(
        server.prisma,
        request.user!.id,
        new Date(),
        server.runtimeConfig.fishTank.feedCooldownSeconds,
        server.runtimeConfig.fishTank.hatchProgressCost
      );
      return ok(summary);
    }
  );

  server.post(
    "/v1/fish-tank/initialize",
    {
      ...rateLimitFor(server, "fishTank"),
      preHandler: [server.requireAuth]
    },
    async (request, reply) => {
      try {
        const { summary, created } = await initializeTank(
          server.prisma,
          request.user!.id,
          server.runtimeConfig.fishTank.starterFishCode,
          server.runtimeConfig.fishTank.feedCooldownSeconds,
          server.runtimeConfig.fishTank.hatchProgressCost,
          new Date(),
          request.trace
        );

        await recordAuditEventWithClient(server.prisma, {
          eventType: created ? "fish_tank.initialized" : "fish_tank.initialize.repeated",
          actorUserId: request.user!.id,
          targetUserId: request.user!.id,
          sourceType: "fish_tank",
          metadata: {
            starterFishCode: server.runtimeConfig.fishTank.starterFishCode,
            fishCount: summary.fish.length,
            requestId: request.trace.requestId
          },
          trace: request.trace
        });

        return ok(summary);
      } catch (error) {
        if (error instanceof FishTankError) {
          return reply.code(409).send(fail(error.code, error.message, request.trace));
        }
        throw error;
      }
    }
  );

  server.post(
    "/v1/fish-tank/interactions",
    {
      ...rateLimitFor(server, "fishTank"),
      preHandler: [server.requireAuth],
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["interactionType", "idempotencyKey"],
          properties: {
            interactionType: { type: "string", minLength: 1, maxLength: 32 },
            idempotencyKey: { type: "string", minLength: 8, maxLength: 128 }
          }
        }
      }
    },
    async (request, reply) => {
      const body = request.body as CareInteractionInput;

      try {
        const result = await performCareInteraction(
          server.prisma,
          request.user!.id,
          body,
          server.runtimeConfig.fishTank.feedCooldownSeconds,
          server.runtimeConfig.fishTank.hatchProgressCost,
          new Date(),
          request.trace
        );

        await recordAuditEventWithClient(server.prisma, {
          eventType: result.success ? "fish_tank.care.completed" : "fish_tank.care.unavailable",
          actorUserId: request.user!.id,
          targetUserId: request.user!.id,
          sourceType: "fish_care_event",
          metadata: {
            interactionType: body.interactionType,
            success: result.success,
            resultCopy: result.resultCopy,
            requestId: request.trace.requestId
          },
          trace: request.trace
        });

        return ok(result);
      } catch (error) {
        if (error instanceof FishTankError) {
          const statusCode = error.code === "TANK_NOT_INITIALIZED" ? 409 : 400;
          return reply.code(statusCode).send(fail(error.code, error.message, request.trace));
        }
        throw error;
      }
    }
  );

  server.post(
    "/v1/fish-tank/hatch",
    {
      ...rateLimitFor(server, "fishTank"),
      preHandler: [server.requireAuth],
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["idempotencyKey"],
          properties: {
            idempotencyKey: { type: "string", minLength: 8, maxLength: 128 }
          }
        }
      }
    },
    async (request, reply) => {
      const body = request.body as HatchInput;

      try {
        const result = await performHatch(
          server.prisma,
          request.user!.id,
          body,
          server.runtimeConfig.fishTank.hatchProgressCost,
          server.runtimeConfig.fishTank.feedCooldownSeconds,
          new Date(),
          request.trace
        );

        const auditEventType = result.success
          ? result.replayed
            ? "fish_tank.hatch.replayed"
            : "fish_tank.hatch.completed"
          : result.outcomeCode === "INSUFFICIENT_HATCH_PROGRESS"
            ? "fish_tank.hatch.insufficient_progress"
            : result.outcomeCode === "FISH_CATALOG_COMPLETE"
              ? "fish_tank.hatch.catalog_complete"
              : "fish_tank.hatch.failed";

        await recordAuditEventWithClient(server.prisma, {
          eventType: auditEventType,
          actorUserId: request.user!.id,
          targetUserId: request.user!.id,
          sourceType: "fish_hatch_event",
          metadata: {
            idempotencyKey: body.idempotencyKey,
            outcomeCode: result.outcomeCode,
            replayed: result.replayed,
            cost: result.cost,
            fishDefinitionId: result.discoveredFish?.definitionId ?? null,
            requestId: request.trace.requestId
          },
          trace: request.trace
        });

        return ok(result);
      } catch (error) {
        if (error instanceof FishTankError) {
          const statusCode = error.code === "TANK_NOT_INITIALIZED" ? 409 : 400;
          return reply.code(statusCode).send(fail(error.code, error.message, request.trace));
        }
        if (error instanceof FishTankResourceError) {
          return reply
            .code(409)
            .send(fail(error.code, error.message, request.trace));
        }
        throw error;
      }
    }
  );
}
