import {
  BeanTheme,
  RewardSourceType,
  RewardType,
  type BeanDefinition,
  type BeanInventory
} from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { evaluateAchievements } from "../achievements/evaluator.js";
import { recordAuditEventWithClient } from "../audit/events.js";
import {
  BEAN_PITY_THRESHOLD,
  FRAGMENTS_PER_DRAW,
  deriveBeanCombinations,
  duplicateFragments,
  selectBean
} from "../beans/rules.js";
import { fail, ok } from "../http/envelope.js";
import { rateLimitFor } from "../rate-limit/policies.js";
import {
  grantResourcesFromBeanDraw,
  type FishTankResourceOutcome
} from "../fish-tank/resources.js";

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

      const [stats, showcase] = await Promise.all([
        server.prisma.userStats.findUnique({ where: { userId: request.user!.id } }),
        server.prisma.beanShowcase.findMany({
          where: { userId: request.user!.id },
          orderBy: { position: "asc" },
          include: { bean: true }
        })
      ]);
      const serialized = beans.map(serializeBean);
      const ownedCodes = new Set(serialized.filter((bean) => bean.owned).map((bean) => bean.code));
      const collectedCount = serialized.filter((bean) => bean.owned).length;
      const totalCount = serialized.length;
      const nextTarget = findNextBeanTarget(serialized);

      return ok({
        drawChances: stats?.drawChances ?? 0,
        drawProgress: stats?.drawProgress ?? 0,
        fragments: stats?.beanFragments ?? 0,
        fragmentExchangeCost: FRAGMENTS_PER_DRAW,
        pityCount: stats?.beanPityCount ?? 0,
        pityThreshold: BEAN_PITY_THRESHOLD,
        summary: {
          collected: collectedCount,
          total: totalCount,
          percent: totalCount > 0 ? Math.floor((collectedCount / totalCount) * 100) : 0,
          nextAction:
            nextTarget === null
              ? "图鉴已经全亮，可以把喜欢的豆摆进展示柜。"
              : "继续完成打卡、活动或目标奖励，攒机会抽下一颗命运豆。"
        },
        nextTarget,
        beans: serialized,
        themes: Object.values(BeanTheme).map((theme) => {
          const themed = serialized.filter((bean) => bean.theme === theme);
          return {
            theme,
            collected: themed.filter((bean) => bean.owned).length,
            total: themed.length
          };
        }),
        combinations: deriveBeanCombinations(ownedCodes),
        showcase: showcase.map((item) => ({
          position: item.position,
          bean: serializeBean({ ...item.bean, inventory: [{ quantity: 1 }] })
        }))
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
            idempotencyKey: { type: "string", minLength: 8, maxLength: 128 },
            theme: { type: "string", enum: Object.values(BeanTheme) }
          }
        }
      }
    },
    async (request, reply) => {
      const body = request.body as { idempotencyKey?: string; theme?: BeanTheme } | undefined;
      const theme = body?.theme ?? BeanTheme.office;
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
          theme,
          weight: { gt: 0 }
        }
      });

      if (pool.length === 0) {
        return reply.code(503).send(fail("BEAN_POOL_EMPTY", "Bean pool is empty", request.trace));
      }

      const selection = selectBean(pool, stats.beanPityCount);
      const selected = selection.bean;
      const now = new Date();
      const remainingDrawChances = stats.drawChances - 1;

      const drawIdempotencyKey = body?.idempotencyKey ?? `draw_${request.trace.requestId}`;

      const result = await server.prisma.$transaction(async (tx) => {
        await tx.userStats.update({
          where: { userId: request.user!.id },
          data: {
            drawChances: { decrement: 1 },
            beanPityCount: selection.nextPityCount
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

        const duplicate = Boolean(existing);
        const fragmentsGranted = duplicate ? duplicateFragments[selected.rarity] : 0;
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
        if (fragmentsGranted > 0) {
          await tx.userStats.update({
            where: { userId: request.user!.id },
            data: { beanFragments: { increment: fragmentsGranted } }
          });
        }

        await tx.rewardLedger.create({
          data: {
            userId: request.user!.id,
            sourceType: RewardSourceType.bean_draw,
            sourceId: null,
            rewardType: RewardType.bean,
            amount: 1,
            idempotencyKey: drawIdempotencyKey,
            metadata: {
              requestId: request.trace.requestId,
              traceId: request.trace.traceId,
              spanId: request.trace.spanId,
              beanId: selected.id,
              rarity: selected.rarity,
              duplicate,
              theme,
              pityTriggered: selection.pityTriggered,
              fragmentsGranted
            }
          }
        });

        const fishTankOutcomes = await grantResourcesFromBeanDraw(tx, request.user!.id, {
          drawIdempotencyKey,
          rarity: selected.rarity,
          duplicate,
          pityTriggered: selection.pityTriggered
        });

        return {
          inventory,
          duplicate,
          fragmentsGranted,
          remainingDrawChances,
          fishTankOutcomes
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
          theme,
          pityTriggered: selection.pityTriggered,
          fragmentsGranted: result.fragmentsGranted,
          remainingDrawChances: result.remainingDrawChances,
          fishTankOutcomes: result.fishTankOutcomes.map((outcome) => ({
            resourceType: outcome.resourceType,
            quantity: outcome.quantity
          }))
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
        fragmentsGranted: result.fragmentsGranted,
        pityTriggered: selection.pityTriggered,
        pityCount: selection.nextPityCount,
        remainingDrawChances: result.remainingDrawChances,
        fishTankOutcomes: result.fishTankOutcomes,
        resultTitle: drawResultTitle({
          duplicate: result.duplicate,
          pityTriggered: selection.pityTriggered,
          rarity: selected.rarity
        }),
        resultCopy: drawResultCopy({
          beanName: selected.name,
          duplicate: result.duplicate,
          fragmentsGranted: result.fragmentsGranted,
          pityTriggered: selection.pityTriggered
        }),
        nextHint:
          result.remainingDrawChances > 0
            ? `还剩 ${result.remainingDrawChances} 次机会，可以继续抽。`
            : "机会用完了，去完成打卡、活动或目标奖励继续攒。",
        achievementsUnlocked
      });
    }
  );

  server.post(
    "/v1/beans/fragments/exchange",
    { ...rateLimitFor(server, "beanDraws"), preHandler: [server.requireAuth] },
    async (request, reply) => {
      const result = await server.prisma.userStats.updateMany({
        where: { userId: request.user!.id, beanFragments: { gte: FRAGMENTS_PER_DRAW } },
        data: {
          beanFragments: { decrement: FRAGMENTS_PER_DRAW },
          drawChances: { increment: 1 }
        }
      });
      if (result.count === 0) {
        return reply.code(409).send(
          fail("INSUFFICIENT_BEAN_FRAGMENTS", "Not enough bean fragments", request.trace)
        );
      }
      const stats = await server.prisma.userStats.findUnique({
        where: { userId: request.user!.id }
      });
      return ok({
        fragments: stats?.beanFragments ?? 0,
        drawChances: stats?.drawChances ?? 0
      });
    }
  );

  server.put(
    "/v1/beans/showcase/:position",
    {
      ...rateLimitFor(server, "beanDraws"),
      preHandler: [server.requireAuth],
      schema: {
        params: {
          type: "object",
          required: ["position"],
          properties: { position: { type: "integer", minimum: 1, maximum: 3 } }
        },
        body: {
          type: "object",
          required: ["beanId"],
          additionalProperties: false,
          properties: { beanId: { type: "string", format: "uuid" } }
        }
      }
    },
    async (request, reply) => {
      const { position } = request.params as { position: number };
      const { beanId } = request.body as { beanId: string };
      const owned = await server.prisma.beanInventory.findUnique({
        where: { userId_beanId: { userId: request.user!.id, beanId } }
      });
      if (!owned || owned.quantity <= 0) {
        return reply.code(404).send(fail("BEAN_NOT_OWNED", "Bean is not owned", request.trace));
      }
      await server.prisma.$transaction(async (tx) => {
        await tx.beanShowcase.deleteMany({
          where: { userId: request.user!.id, beanId }
        });
        await tx.beanShowcase.upsert({
          where: { userId_position: { userId: request.user!.id, position } },
          create: { userId: request.user!.id, beanId, position },
          update: { beanId }
        });
      });
      return ok({ position, beanId });
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
    theme: bean.theme,
    description: bean.description,
    quantity,
    owned: quantity > 0
  };
}

function findNextBeanTarget(beans: ReturnType<typeof serializeBean>[]) {
  const missing = beans
    .filter((bean) => !bean.owned)
    .sort((left, right) => {
      const byTheme = left.theme.localeCompare(right.theme);
      if (byTheme !== 0) return byTheme;
      const byRarity = rarityRank(left.rarity) - rarityRank(right.rarity);
      if (byRarity !== 0) return byRarity;
      return left.name.localeCompare(right.name);
    })[0];
  if (!missing) return null;
  return {
    id: missing.id,
    code: missing.code,
    name: missing.name,
    rarity: missing.rarity,
    theme: missing.theme,
    hint: `下一颗可以追 ${missing.name}，来自${themeLabel(missing.theme)}。`
  };
}

function drawResultTitle(input: {
  duplicate: boolean;
  pityTriggered: boolean;
  rarity: BeanDefinition["rarity"];
}): string {
  if (input.pityTriggered) return "保底豆落袋";
  if (input.duplicate) return "重复豆变碎片";
  if (["epic", "legendary"].includes(input.rarity)) return "高光豆入仓";
  return "新豆入仓";
}

function drawResultCopy(input: {
  beanName: string;
  duplicate: boolean;
  fragmentsGranted: number;
  pityTriggered: boolean;
}): string {
  if (input.duplicate) {
    return `${input.beanName} 已经在仓里了，这次转化为数量 +1 和 ${input.fragmentsGranted} 个碎片。`;
  }
  if (input.pityTriggered) {
    return `${input.beanName} 被保底机制请了出来，图鉴又亮了一格。`;
  }
  return `${input.beanName} 第一次加入豆仓，图鉴完成度已更新。`;
}

function rarityRank(rarity: BeanDefinition["rarity"]): number {
  return { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 }[rarity];
}

function themeLabel(theme: BeanTheme): string {
  return {
    office: "工位卡池",
    restroom: "隔间卡池",
    daydream: "白日梦卡池"
  }[theme];
}
