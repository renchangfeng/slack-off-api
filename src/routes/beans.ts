import { RewardSourceType, RewardType, type BeanDefinition, type BeanInventory } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { evaluateAchievements } from "../achievements/evaluator.js";
import { recordAuditEventWithClient } from "../audit/events.js";
import { fail, ok } from "../http/envelope.js";
import { rateLimitFor } from "../rate-limit/policies.js";

type BeanWithQuantity = BeanDefinition & {
  inventory: Array<Pick<BeanInventory, "quantity">>;
};

export async function registerBeanRoutes(server: FastifyInstance) {
  server.get(
    "/v1/beans/collection",
    {
      ...rateLimitFor(server, "beanDraws"),
      preHandler: [server.requireAuth]
    },
    async (request) => {
      const beans = await server.prisma.beanDefinition.findMany({
        where: { active: true },
        orderBy: [{ rarity: "asc" }, { name: "asc" }],
        include: {
          inventory: {
            where: { userId: request.user!.id },
            select: { quantity: true }
          }
        }
      });

      const stats = await server.prisma.userStats.findUnique({
        where: { userId: request.user!.id }
      });

      return ok({
        drawChances: stats?.drawChances ?? 0,
        drawProgress: stats?.drawProgress ?? 0,
        beans: beans.map(serializeBean)
      });
    }
  );

  server.post(
    "/v1/beans/draw",
    {
      ...rateLimitFor(server, "beanDraws"),
      preHandler: [server.requireAuth],
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            idempotencyKey: { type: "string", minLength: 8, maxLength: 128 }
          }
        }
      }
    },
    async (request, reply) => {
      const body = request.body as { idempotencyKey?: string } | undefined;
      const stats = await server.prisma.userStats.findUnique({
        where: { userId: request.user!.id }
      });

      if (!stats || stats.drawChances <= 0) {
        await recordAuditEventWithClient(server.prisma, {
          eventType: "bean.draw.rejected",
          actorUserId: request.user!.id,
          targetUserId: request.user!.id,
          sourceType: "bean_draw",
          metadata: { reason: "NO_DRAW_CHANCE" },
          trace: request.trace
        });

        return reply
          .code(409)
          .send(fail("NO_DRAW_CHANCE", "No bean draw chance available", request.trace));
      }

      const pool = await server.prisma.beanDefinition.findMany({
        where: {
          active: true,
          weight: { gt: 0 }
        }
      });

      if (pool.length === 0) {
        return reply.code(503).send(fail("BEAN_POOL_EMPTY", "Bean pool is empty", request.trace));
      }

      const selected = selectWeightedBean(pool);
      const now = new Date();
      const remainingDrawChances = stats.drawChances - 1;

      const result = await server.prisma.$transaction(async (tx) => {
        await tx.userStats.update({
          where: { userId: request.user!.id },
          data: {
            drawChances: { decrement: 1 }
          }
        });

        const existing = await tx.beanInventory.findUnique({
          where: {
            userId_beanId: {
              userId: request.user!.id,
              beanId: selected.id
            }
          }
        });

        const inventory = await tx.beanInventory.upsert({
          where: {
            userId_beanId: {
              userId: request.user!.id,
              beanId: selected.id
            }
          },
          create: {
            userId: request.user!.id,
            beanId: selected.id,
            quantity: 1,
            firstObtainedAt: now,
            lastObtainedAt: now
          },
          update: {
            quantity: { increment: 1 },
            lastObtainedAt: now
          }
        });

        await tx.rewardLedger.create({
          data: {
            userId: request.user!.id,
            sourceType: RewardSourceType.bean_draw,
            sourceId: null,
            rewardType: RewardType.bean,
            amount: 1,
            idempotencyKey: body?.idempotencyKey,
            metadata: {
              requestId: request.trace.requestId,
              traceId: request.trace.traceId,
              spanId: request.trace.spanId,
              beanId: selected.id,
              rarity: selected.rarity,
              duplicate: Boolean(existing)
            }
          }
        });

        return {
          inventory,
          duplicate: Boolean(existing),
          remainingDrawChances
        };
      });

      await recordAuditEventWithClient(server.prisma, {
        eventType: "bean.draw.completed",
        actorUserId: request.user!.id,
        targetUserId: request.user!.id,
        sourceType: "bean_definition",
        sourceId: selected.id,
        metadata: {
          beanId: selected.id,
          rarity: selected.rarity,
          duplicate: result.duplicate,
          remainingDrawChances: result.remainingDrawChances
        },
        trace: request.trace
      });

      const achievementsUnlocked = await evaluateAchievements(server.prisma, {
        userId: request.user!.id,
        now,
        trace: request.trace
      });

      return ok({
        bean: serializeBean({ ...selected, inventory: [{ quantity: result.inventory.quantity }] }),
        duplicate: result.duplicate,
        remainingDrawChances: result.remainingDrawChances,
        achievementsUnlocked
      });
    }
  );
}

export function selectWeightedBean<T extends { weight: number }>(pool: T[]): T {
  const totalWeight = pool.reduce((sum, bean) => sum + bean.weight, 0);
  let cursor = Math.random() * totalWeight;

  for (const bean of pool) {
    cursor -= bean.weight;
    if (cursor <= 0) {
      return bean;
    }
  }

  return pool[pool.length - 1];
}

function serializeBean(bean: BeanWithQuantity) {
  const quantity = bean.inventory[0]?.quantity ?? 0;
  return {
    id: bean.id,
    code: bean.code,
    name: bean.name,
    rarity: bean.rarity,
    description: bean.description,
    quantity,
    owned: quantity > 0
  };
}
