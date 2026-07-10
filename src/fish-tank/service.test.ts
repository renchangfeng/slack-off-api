import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { FishTankResourceType } from "./resources.js";
import { performHatch, type PrismaClientLike } from "./service.js";

const userId = "11111111-1111-4111-8111-111111111111";
const starterFishId = "33333333-3333-4333-8333-333333333333";
const printerPeaceId = "44444444-4444-4444-8444-444444444444";

const trace = { requestId: "req-1", traceId: "trc_1", spanId: "span-1" };

function resolveDefinition(
  definitions: Map<string, { id: string; code: string; name: string; rarity: string; theme: string; personality: string; artKey: string; sourceHint: string; active: boolean; sortOrder: number }>,
  id: string
) {
  for (const def of definitions.values()) {
    if (def.id === id) return def;
  }
  return undefined;
}

function createMockPrisma(initialLedger: Array<{ userId: string; resourceType: FishTankResourceType; quantity: number; idempotencyKey: string }> = []) {
  const ledger = [...initialLedger];
  const userTanks = new Map<string, { userId: string }>();
  const userFish = new Map<string, { id: string; userId: string; fishDefinitionId: string; acquiredSource: string; displayOrder: number; createdAt: Date }>();
  const hatchEvents: Array<{
    id: string;
    userId: string;
    fishDefinitionId: string;
    idempotencyKey: string;
    hatchCost: number;
    outcomeCode: string;
    duplicate: boolean;
    resultMetadata: Record<string, unknown>;
    createdAt: Date;
  }> = [];

  const definitions = new Map<string, { id: string; code: string; name: string; rarity: string; theme: string; personality: string; artKey: string; sourceHint: string; active: boolean; sortOrder: number }>([
    ["starter_goldfish", { id: starterFishId, code: "starter_goldfish", name: "摸鱼初心小金", rarity: "common", theme: "daydream", personality: "假装工作的", artKey: "fish-starter-goldfish", sourceHint: "starter", active: true, sortOrder: 1 }],
    ["printer_peace_beta", { id: printerPeaceId, code: "printer_peace_beta", name: "打印机和平贝塔", rarity: "common", theme: "office", personality: "宽容卡纸的", artKey: "fish-printer-peace-beta", sourceHint: "hatch", active: true, sortOrder: 2 }]
  ]);

  const txLike = {
    userTank: {
      findUnique: async ({ where }: { where: { userId: string } }) => userTanks.get(where.userId) ?? null
    },
    userFish: {
      findMany: async ({ where, include }: { where: { userId: string }; include?: { definition: boolean } }) => {
        const rows = [...userFish.values()].filter((f) => f.userId === where.userId);
        if (include?.definition) {
          return rows.map((f) => ({ ...f, definition: resolveDefinition(definitions, f.fishDefinitionId) }));
        }
        return rows;
      },
      findUnique: async ({ where, include }: { where: { userId_fishDefinitionId: { userId: string; fishDefinitionId: string } }; include?: { definition: boolean } }) => {
        const fish = userFish.get(`${where.userId_fishDefinitionId.userId}:${where.userId_fishDefinitionId.fishDefinitionId}`) ?? null;
        if (fish && include?.definition) {
          return { ...fish, definition: resolveDefinition(definitions, fish.fishDefinitionId) };
        }
        return fish;
      },
      create: async ({ data, include }: { data: { userId: string; fishDefinitionId: string; acquiredSource: string; displayOrder: number }; include?: { definition: boolean } }) => {
        const fish = { id: `fish-${userFish.size + 1}`, ...data, createdAt: new Date() };
        userFish.set(`${data.userId}:${data.fishDefinitionId}`, fish);
        if (include?.definition) {
          return { ...fish, definition: definitions.get([...definitions.entries()].find(([, d]) => d.id === data.fishDefinitionId)?.[0] ?? "") };
        }
        return fish;
      }
    },
    fishDefinition: {
      findUnique: async ({ where }: { where: { id?: string; code?: string } }) => {
        if (where.id) {
          for (const def of definitions.values()) {
            if (def.id === where.id) return def;
          }
        }
        if (where.code) return definitions.get(where.code) ?? null;
        return null;
      },
      findMany: async ({ where }: { where?: { active?: boolean } }) => {
        let defs = [...definitions.values()];
        if (where?.active !== undefined) defs = defs.filter((d) => d.active === where.active);
        defs.sort((a, b) => a.sortOrder - b.sortOrder);
        return defs;
      }
    },
    fishCareEvent: {
      findFirst: async () => null
    },
    fishTankResourceLedger: {
      upsert: async ({ where, create }: { where: { userId_idempotencyKey: { userId: string; idempotencyKey: string } }; create: { userId: string; resourceType: FishTankResourceType; quantity: number; sourceType: string; sourceId: string | null; idempotencyKey: string; metadata: object } }) => {
        const existing = ledger.find((e) => e.userId === where.userId_idempotencyKey.userId && e.idempotencyKey === where.userId_idempotencyKey.idempotencyKey);
        if (existing) return existing;
        ledger.push({ userId: create.userId, resourceType: create.resourceType, quantity: create.quantity, idempotencyKey: where.userId_idempotencyKey.idempotencyKey });
        return ledger[ledger.length - 1];
      },
      groupBy: async ({ where }: { where: { userId: string } }) => {
        const groups = new Map<FishTankResourceType, number>();
        for (const entry of ledger) {
          if (entry.userId === where.userId) {
            groups.set(entry.resourceType, (groups.get(entry.resourceType) ?? 0) + entry.quantity);
          }
        }
        return Array.from(groups.entries()).map(([resourceType, quantity]) => ({ resourceType, _sum: { quantity } }));
      },
      aggregate: async ({ where }: { where: { userId: string; resourceType: FishTankResourceType } }) => {
        const total = ledger
          .filter((e) => e.userId === where.userId && e.resourceType === where.resourceType)
          .reduce((sum, e) => sum + e.quantity, 0);
        return { _sum: { quantity: total } };
      }
    },
    fishHatchEvent: {
      findUnique: async ({ where }: { where: { userId_idempotencyKey: { userId: string; idempotencyKey: string } } }) =>
        hatchEvents.find((e) => e.userId === where.userId_idempotencyKey.userId && e.idempotencyKey === where.userId_idempotencyKey.idempotencyKey) ?? null,
      create: async ({ data }: { data: { userId: string; fishDefinitionId: string; idempotencyKey: string; hatchCost: number; outcomeCode: string; duplicate: boolean; resultMetadata: Record<string, unknown> } }) => {
        const event = { id: `hatch-${hatchEvents.length + 1}`, ...data, createdAt: new Date() };
        hatchEvents.push(event);
        return event;
      }
    },
    $queryRaw: async () => [{ userId }]
  };

  const prisma = {
    ...txLike,
    $transaction: async <T>(fn: (tx: typeof txLike) => Promise<T>) => fn(txLike)
  };

  return { prisma: prisma as unknown as PrismaClientLike, ledger, userTanks, userFish, hatchEvents };
}

describe("performHatch", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it("returns success and grants a new fish with sufficient progress", async () => {
    const { prisma, userTanks, userFish } = createMockPrisma([
      { userId, resourceType: FishTankResourceType.hatch_progress, quantity: 5, idempotencyKey: "grant-1" }
    ]);
    userTanks.set(userId, { userId });
    userFish.set(`${userId}:${starterFishId}`, { id: "fish-1", userId, fishDefinitionId: starterFishId, acquiredSource: "starter", displayOrder: 0, createdAt: new Date() });

    const result = await performHatch(prisma, userId, { idempotencyKey: "hatch-key-1" }, 3, 4 * 60 * 60, new Date(), trace);

    expect(result.success).toBe(true);
    expect(result.replayed).toBe(false);
    expect(result.cost).toBe(3);
    expect(result.discoveredFish).not.toBeNull();
    expect(result.tank.hatchAvailability.currentProgress).toBe(2);
  });

  it("returns replay state without double debit", async () => {
    const { prisma, userTanks, userFish } = createMockPrisma([
      { userId, resourceType: FishTankResourceType.hatch_progress, quantity: 6, idempotencyKey: "grant-1" }
    ]);
    userTanks.set(userId, { userId });
    userFish.set(`${userId}:${starterFishId}`, { id: "fish-1", userId, fishDefinitionId: starterFishId, acquiredSource: "starter", displayOrder: 0, createdAt: new Date() });

    const first = await performHatch(prisma, userId, { idempotencyKey: "hatch-key-1" }, 3, 4 * 60 * 60, new Date(), trace);
    const second = await performHatch(prisma, userId, { idempotencyKey: "hatch-key-1" }, 3, 4 * 60 * 60, new Date(), trace);

    expect(second.replayed).toBe(true);
    expect(second.discoveredFish?.definitionId).toBe(first.discoveredFish?.definitionId);
    expect(second.discoveredFish?.id).toBe(first.discoveredFish?.id);
    expect(second.tank.hatchAvailability.currentProgress).toBe(3);
  });

  it("returns insufficient progress without mutation", async () => {
    const { prisma, userTanks, userFish } = createMockPrisma([
      { userId, resourceType: FishTankResourceType.hatch_progress, quantity: 2, idempotencyKey: "grant-1" }
    ]);
    userTanks.set(userId, { userId });
    userFish.set(`${userId}:${starterFishId}`, { id: "fish-1", userId, fishDefinitionId: starterFishId, acquiredSource: "starter", displayOrder: 0, createdAt: new Date() });

    const result = await performHatch(prisma, userId, { idempotencyKey: "hatch-key-1" }, 3, 4 * 60 * 60, new Date(), trace);

    expect(result.success).toBe(false);
    expect(result.outcomeCode).toBe("INSUFFICIENT_HATCH_PROGRESS");
    expect(result.tank.hatchAvailability.currentProgress).toBe(2);
    expect(result.tank.collection.owned).toBe(1);
  });
});
