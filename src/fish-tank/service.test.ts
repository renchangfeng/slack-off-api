import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { FishTankResourceType } from "./resources.js";
import {
  getTankSummary,
  performEquipDecoration,
  performHatch,
  type PrismaClientLike
} from "./service.js";

const userId = "11111111-1111-4111-8111-111111111111";
const starterFishId = "33333333-3333-4333-8333-333333333333";
const printerPeaceId = "44444444-4444-4444-8444-444444444444";

const defaultBgId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const defaultPlantId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const defaultPropId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const defaultAmbientId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const lockedBgId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const lockedPlantId = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const trace = { requestId: "req-1", traceId: "trc_1", spanId: "span-1" };

type FishDef = {
  id: string;
  code: string;
  name: string;
  rarity: string;
  theme: string;
  personality: string;
  artKey: string;
  sourceHint: string;
  active: boolean;
  sortOrder: number;
};

type DecorDef = {
  id: string;
  code: string;
  name: string;
  type: string;
  rarity: string;
  theme: string | null;
  artKey: string;
  unlockHint: string;
  active: boolean;
  sortOrder: number;
};

function resolveDefinition(definitions: Map<string, FishDef>, id: string) {
  for (const def of definitions.values()) {
    if (def.id === id) return def;
  }
  return undefined;
}

function resolveDecorDefinition(definitions: Map<string, DecorDef>, id: string) {
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
  const careEvents: Array<{
    id: string;
    userId: string;
    interactionType: string;
    idempotencyKey: string;
    resultMetadata: Record<string, unknown>;
    createdAt: Date;
  }> = [];
  const ownedDecorations = new Map<string, { userId: string; decorationDefinitionId: string; quantity: number; acquiredSource: string; createdAt: Date; updatedAt: Date }>();
  const equippedDecorations = new Map<string, { userId: string; slot: string; decorationDefinitionId: string; equippedAt: Date }>();
  const equipEvents: Array<{
    id: string;
    userId: string;
    slot: string;
    decorationDefinitionId: string;
    idempotencyKey: string;
    outcomeCode: string;
    replay: boolean;
    resultMetadata: Record<string, unknown>;
    createdAt: Date;
  }> = [];

  const definitions = new Map<string, FishDef>([
    ["starter_goldfish", { id: starterFishId, code: "starter_goldfish", name: "摸鱼初心小金", rarity: "common", theme: "daydream", personality: "假装工作的", artKey: "fish-starter-goldfish", sourceHint: "starter", active: true, sortOrder: 1 }],
    ["printer_peace_beta", { id: printerPeaceId, code: "printer_peace_beta", name: "打印机和平贝塔", rarity: "common", theme: "office", personality: "宽容卡纸的", artKey: "fish-printer-peace-beta", sourceHint: "hatch", active: true, sortOrder: 2 }]
  ]);

  const decorDefinitions = new Map<string, DecorDef>([
    ["default_tank_background", { id: defaultBgId, code: "default_tank_background", name: "基础水缸", type: "background", rarity: "common", theme: "default", artKey: "tank-bg-default", unlockHint: "初始鱼缸背景", active: true, sortOrder: 1 }],
    ["default_tank_plant", { id: defaultPlantId, code: "default_tank_plant", name: "基础水草", type: "plant", rarity: "common", theme: "default", artKey: "tank-plant-default", unlockHint: "初始鱼缸植物", active: true, sortOrder: 2 }],
    ["default_tank_prop_empty", { id: defaultPropId, code: "default_tank_prop_empty", name: "空石头", type: "prop", rarity: "common", theme: "default", artKey: "tank-prop-empty", unlockHint: "初始鱼缸小景", active: true, sortOrder: 3 }],
    ["default_tank_ambient_bubbles", { id: defaultAmbientId, code: "default_tank_ambient_bubbles", name: "基础泡泡", type: "ambient", rarity: "common", theme: "default", artKey: "tank-ambient-bubbles", unlockHint: "初始水底气泡", active: true, sortOrder: 4 }],
    ["office_window_background", { id: lockedBgId, code: "office_window_background", name: "工位窗景", type: "background", rarity: "rare", theme: "office", artKey: "tank-bg-office-window", unlockHint: "收集 5 种不同的工位命运豆", active: true, sortOrder: 11 }],
    ["kelp_forest_plant", { id: lockedPlantId, code: "kelp_forest_plant", name: "海藻丛", type: "plant", rarity: "uncommon", theme: "default", artKey: "tank-plant-kelp-forest", unlockHint: "完成 3 次喂鱼", active: true, sortOrder: 21 }]
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
      findFirst: async ({ where, orderBy }: { where: { userId: string; interactionType?: string }; orderBy?: { createdAt: "desc" | "asc" } }) => {
        let rows = careEvents.filter((e) => e.userId === where.userId);
        if (where.interactionType) rows = rows.filter((e) => e.interactionType === where.interactionType);
        rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return rows[0] ?? null;
      },
      create: async ({ data }: { data: { userId: string; interactionType: string; idempotencyKey: string; resultMetadata: Record<string, unknown> } }) => {
        const event = { id: `care-${careEvents.length + 1}`, ...data, createdAt: new Date() };
        careEvents.push(event);
        return event;
      }
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
      findFirst: async ({ where, orderBy }: { where: { userId: string }; orderBy?: { createdAt: "desc" | "asc" } }) => {
        const rows = hatchEvents.filter((e) => e.userId === where.userId);
        rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return rows[0] ?? null;
      },
      create: async ({ data }: { data: { userId: string; fishDefinitionId: string; idempotencyKey: string; hatchCost: number; outcomeCode: string; duplicate: boolean; resultMetadata: Record<string, unknown> } }) => {
        const event = { id: `hatch-${hatchEvents.length + 1}`, ...data, createdAt: new Date() };
        hatchEvents.push(event);
        return event;
      }
    },
    tankDecorationDefinition: {
      findUnique: async ({ where }: { where: { id?: string; code?: string } }) => {
        if (where.id) return resolveDecorDefinition(decorDefinitions, where.id) ?? null;
        if (where.code) return decorDefinitions.get(where.code) ?? null;
        return null;
      },
      findMany: async ({ where, orderBy }: { where?: { active?: boolean }; orderBy?: Array<{ type?: "asc" | "desc"; sortOrder?: "asc" | "desc" }> }) => {
        let defs = [...decorDefinitions.values()];
        if (where?.active !== undefined) defs = defs.filter((d) => d.active === where.active);
        defs.sort((a, b) => {
          if (a.type !== b.type) return a.type.localeCompare(b.type);
          return a.sortOrder - b.sortOrder;
        });
        return defs;
      }
    },
    userTankDecoration: {
      findMany: async ({ where }: { where: { userId: string } }) =>
        [...ownedDecorations.values()].filter((d) => d.userId === where.userId),
      findUnique: async ({ where }: { where: { userId_decorationDefinitionId: { userId: string; decorationDefinitionId: string } } }) => {
        const key = `${where.userId_decorationDefinitionId.userId}:${where.userId_decorationDefinitionId.decorationDefinitionId}`;
        return ownedDecorations.get(key) ?? null;
      },
      upsert: async ({ where, create }: { where: { userId_decorationDefinitionId: { userId: string; decorationDefinitionId: string } }; create: { userId: string; decorationDefinitionId: string; quantity: number; acquiredSource: string } }) => {
        const key = `${where.userId_decorationDefinitionId.userId}:${where.userId_decorationDefinitionId.decorationDefinitionId}`;
        const existing = ownedDecorations.get(key);
        if (existing) return existing;
        const created = { ...create, createdAt: new Date(), updatedAt: new Date() };
        ownedDecorations.set(key, created);
        return created;
      }
    },
    userTankEquippedDecoration: {
      findMany: async ({ where }: { where: { userId: string } }) =>
        [...equippedDecorations.values()].filter((d) => d.userId === where.userId),
      findUnique: async ({ where }: { where: { userId_slot: { userId: string; slot: string } } }) =>
        equippedDecorations.get(`${where.userId_slot.userId}:${where.userId_slot.slot}`) ?? null,
      upsert: async ({ where, create, update }: { where: { userId_slot: { userId: string; slot: string } }; create: { userId: string; slot: string; decorationDefinitionId: string }; update: { decorationDefinitionId: string; equippedAt: Date } }) => {
        const key = `${where.userId_slot.userId}:${where.userId_slot.slot}`;
        const existing = equippedDecorations.get(key);
        if (existing) {
          existing.decorationDefinitionId = update.decorationDefinitionId;
          existing.equippedAt = update.equippedAt;
          return existing;
        }
        const created = { ...create, equippedAt: new Date() };
        equippedDecorations.set(key, created);
        return created;
      }
    },
    tankDecorationEquipEvent: {
      findUnique: async ({ where }: { where: { userId_idempotencyKey: { userId: string; idempotencyKey: string } } }) =>
        equipEvents.find((e) => e.userId === where.userId_idempotencyKey.userId && e.idempotencyKey === where.userId_idempotencyKey.idempotencyKey) ?? null,
      create: async ({ data }: { data: { userId: string; slot: string; decorationDefinitionId: string; idempotencyKey: string; outcomeCode: string; replay: boolean; resultMetadata: Record<string, unknown> } }) => {
        const event = { id: `equip-${equipEvents.length + 1}`, ...data, createdAt: new Date() };
        equipEvents.push(event);
        return event;
      }
    },
    $queryRaw: async () => [{ userId }]
  };

  const prisma = {
    ...txLike,
    $transaction: async <T>(fn: (tx: typeof txLike) => Promise<T>) => fn(txLike)
  };

  return {
    prisma: prisma as unknown as PrismaClientLike,
    ledger,
    userTanks,
    userFish,
    hatchEvents,
    careEvents,
    ownedDecorations,
    equippedDecorations,
    equipEvents,
    decorDefinitions
  };
}

describe("getTankSummary decorations", () => {
  it("does not imply decoration ownership before tank initialization", async () => {
    const { prisma } = createMockPrisma();

    const summary = await getTankSummary(prisma, userId, new Date(), 4 * 60 * 60, 3);

    expect(summary.decorations).toEqual({ equipped: [], inventory: [] });
    expect(summary.moodCopy).toBe(summary.mood.copy);
  });

  it("returns default decor for an initialized tank with no equipped rows", async () => {
    const { prisma, userTanks, userFish } = createMockPrisma();
    userTanks.set(userId, { userId });
    userFish.set(`${userId}:${starterFishId}`, { id: "fish-1", userId, fishDefinitionId: starterFishId, acquiredSource: "starter", displayOrder: 0, createdAt: new Date() });

    const summary = await getTankSummary(prisma, userId, new Date(), 4 * 60 * 60, 3);

    expect(summary.decorations.equipped).toHaveLength(4);
    expect(summary.decorations.equipped.map((d) => d.slot).sort()).toEqual(["ambient", "background", "plant", "prop"]);
    expect(summary.decorations.equipped.find((d) => d.slot === "background")?.code).toBe("default_tank_background");
    expect(summary.decorations.inventory.length).toBeGreaterThanOrEqual(4);
    expect(summary.decorations.inventory.every((item) => item.owned)).toBe(false);
    expect(summary.decorations.inventory.find((item) => item.code === "default_tank_background")?.owned).toBe(true);
  });

  it("returns locked artKey as null for unowned non-default decorations", async () => {
    const { prisma, userTanks, userFish } = createMockPrisma();
    userTanks.set(userId, { userId });
    userFish.set(`${userId}:${starterFishId}`, { id: "fish-1", userId, fishDefinitionId: starterFishId, acquiredSource: "starter", displayOrder: 0, createdAt: new Date() });

    const summary = await getTankSummary(prisma, userId, new Date(), 4 * 60 * 60, 3);

    const locked = summary.decorations.inventory.find((item) => item.code === "office_window_background");
    expect(locked?.owned).toBe(false);
    expect(locked?.artKey).toBeNull();
    expect(locked?.unlockHint).toBeTruthy();
  });

  it("reflects equipped owned decoration", async () => {
    const { prisma, userTanks, userFish, ownedDecorations, equippedDecorations } = createMockPrisma();
    userTanks.set(userId, { userId });
    userFish.set(`${userId}:${starterFishId}`, { id: "fish-1", userId, fishDefinitionId: starterFishId, acquiredSource: "starter", displayOrder: 0, createdAt: new Date() });
    ownedDecorations.set(`${userId}:${lockedBgId}`, { userId, decorationDefinitionId: lockedBgId, quantity: 1, acquiredSource: "achievement", createdAt: new Date(), updatedAt: new Date() });
    equippedDecorations.set(`${userId}:background`, { userId, slot: "background", decorationDefinitionId: lockedBgId, equippedAt: new Date() });

    const summary = await getTankSummary(prisma, userId, new Date(), 4 * 60 * 60, 3);

    expect(summary.decorations.equipped.find((d) => d.slot === "background")?.code).toBe("office_window_background");
    expect(summary.decorations.inventory.find((item) => item.code === "office_window_background")?.equipped).toBe(true);
  });

  it("preserves an inactive historical equip without exposing it in inventory", async () => {
    const { prisma, userTanks, userFish, equippedDecorations, decorDefinitions } = createMockPrisma();
    userTanks.set(userId, { userId });
    userFish.set(`${userId}:${starterFishId}`, { id: "fish-1", userId, fishDefinitionId: starterFishId, acquiredSource: "starter", displayOrder: 0, createdAt: new Date() });
    decorDefinitions.get("office_window_background")!.active = false;
    equippedDecorations.set(`${userId}:background`, { userId, slot: "background", decorationDefinitionId: lockedBgId, equippedAt: new Date() });

    const summary = await getTankSummary(prisma, userId, new Date(), 4 * 60 * 60, 3);

    expect(summary.decorations.equipped.find((item) => item.slot === "background")?.code).toBe("office_window_background");
    expect(summary.decorations.inventory.some((item) => item.definitionId === lockedBgId)).toBe(false);
  });
});

describe("getTankSummary mood", () => {
  it("returns idle mood for uninitialized tank", async () => {
    const { prisma } = createMockPrisma();
    const summary = await getTankSummary(prisma, userId, new Date(), 4 * 60 * 60, 3);
    expect(summary.mood.code).toBe("idle");
    expect(summary.mood.title).toBe("等待开缸");
  });

  it("returns excited mood when hatch is available", async () => {
    const { prisma, userTanks, userFish } = createMockPrisma([
      { userId, resourceType: FishTankResourceType.hatch_progress, quantity: 5, idempotencyKey: "grant-1" }
    ]);
    userTanks.set(userId, { userId });
    userFish.set(`${userId}:${starterFishId}`, { id: "fish-1", userId, fishDefinitionId: starterFishId, acquiredSource: "starter", displayOrder: 0, createdAt: new Date() });

    const summary = await getTankSummary(prisma, userId, new Date(), 4 * 60 * 60, 3);

    expect(summary.mood.code).toBe("excited");
    expect(summary.mood.title).toBe("孵化就绪");
  });

  it("returns cozy mood after a recent feed", async () => {
    const { prisma, userTanks, userFish, careEvents } = createMockPrisma();
    userTanks.set(userId, { userId });
    userFish.set(`${userId}:${starterFishId}`, { id: "fish-1", userId, fishDefinitionId: starterFishId, acquiredSource: "starter", displayOrder: 0, createdAt: new Date() });
    careEvents.push({ id: "care-1", userId, interactionType: "feed", idempotencyKey: "feed-1", resultMetadata: {}, createdAt: new Date() });

    const summary = await getTankSummary(prisma, userId, new Date(), 4 * 60 * 60, 3);

    expect(summary.mood.code).toBe("cozy");
    expect(summary.mood.title).toBe("吃饱发呆");
  });

  it("returns sleepy mood with three or more fish", async () => {
    const { prisma, userTanks, userFish } = createMockPrisma();
    userTanks.set(userId, { userId });
    [starterFishId, printerPeaceId, printerPeaceId].forEach((fishDefinitionId, index) => {
      userFish.set(`${userId}:${fishDefinitionId}:${index}`, { id: `fish-${index}`, userId, fishDefinitionId, acquiredSource: index === 0 ? "starter" : "hatch", displayOrder: index, createdAt: new Date() });
    });

    const summary = await getTankSummary(prisma, userId, new Date(), 4 * 60 * 60, 3);

    expect(summary.mood.code).toBe("sleepy");
    expect(summary.mood.title).toBe("鱼群打盹");
  });
});

describe("performEquipDecoration", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it("equips an owned decoration into a matching slot", async () => {
    const { prisma, userTanks, userFish, ownedDecorations } = createMockPrisma();
    userTanks.set(userId, { userId });
    userFish.set(`${userId}:${starterFishId}`, { id: "fish-1", userId, fishDefinitionId: starterFishId, acquiredSource: "starter", displayOrder: 0, createdAt: new Date() });
    ownedDecorations.set(`${userId}:${lockedBgId}`, { userId, decorationDefinitionId: lockedBgId, quantity: 1, acquiredSource: "achievement", createdAt: new Date(), updatedAt: new Date() });

    const result = await performEquipDecoration(
      prisma,
      userId,
      { slot: "background", decorationDefinitionId: lockedBgId, idempotencyKey: "equip-bg-1" },
      4 * 60 * 60,
      3,
      new Date(),
      trace
    );

    expect(result.success).toBe(true);
    expect(result.replayed).toBe(false);
    expect(result.equipped.code).toBe("office_window_background");
    expect(result.tank.decorations.equipped.find((d) => d.slot === "background")?.code).toBe("office_window_background");
  });

  it("allows equipping default decorations without ownership", async () => {
    const { prisma, userTanks, userFish } = createMockPrisma();
    userTanks.set(userId, { userId });
    userFish.set(`${userId}:${starterFishId}`, { id: "fish-1", userId, fishDefinitionId: starterFishId, acquiredSource: "starter", displayOrder: 0, createdAt: new Date() });

    const result = await performEquipDecoration(
      prisma,
      userId,
      { slot: "background", decorationDefinitionId: defaultBgId, idempotencyKey: "equip-default-bg" },
      4 * 60 * 60,
      3,
      new Date(),
      trace
    );

    expect(result.success).toBe(true);
    expect(result.equipped.code).toBe("default_tank_background");
  });

  it("replays an equip request without duplicating the mutation", async () => {
    const { prisma, userTanks, userFish, ownedDecorations, equippedDecorations, equipEvents } = createMockPrisma();
    userTanks.set(userId, { userId });
    userFish.set(`${userId}:${starterFishId}`, { id: "fish-1", userId, fishDefinitionId: starterFishId, acquiredSource: "starter", displayOrder: 0, createdAt: new Date() });
    ownedDecorations.set(`${userId}:${lockedBgId}`, { userId, decorationDefinitionId: lockedBgId, quantity: 1, acquiredSource: "achievement", createdAt: new Date(), updatedAt: new Date() });

    const first = await performEquipDecoration(
      prisma,
      userId,
      { slot: "background", decorationDefinitionId: lockedBgId, idempotencyKey: "equip-bg-1" },
      4 * 60 * 60,
      3,
      new Date(),
      trace
    );

    await performEquipDecoration(
      prisma,
      userId,
      { slot: "background", decorationDefinitionId: defaultBgId, idempotencyKey: "equip-bg-2" },
      4 * 60 * 60,
      3,
      new Date(),
      trace
    );

    const second = await performEquipDecoration(
      prisma,
      userId,
      { slot: "background", decorationDefinitionId: lockedBgId, idempotencyKey: "equip-bg-1" },
      4 * 60 * 60,
      3,
      new Date(),
      trace
    );

    expect(second.replayed).toBe(true);
    expect(second.resultTitle).toBe(first.resultTitle);
    expect(second.resultCopy).toBe(first.resultCopy);
    expect(second.equipped.code).toBe(first.equipped.code);
    expect(second.tank).toEqual(first.tank);
    expect(equippedDecorations.get(`${userId}:background`)?.decorationDefinitionId).toBe(defaultBgId);
    expect(equipEvents.length).toBe(2);
  });

  it("rejects reuse of an idempotency key for a different command", async () => {
    const { prisma, userTanks, userFish, ownedDecorations } = createMockPrisma();
    userTanks.set(userId, { userId });
    userFish.set(`${userId}:${starterFishId}`, { id: "fish-1", userId, fishDefinitionId: starterFishId, acquiredSource: "starter", displayOrder: 0, createdAt: new Date() });
    ownedDecorations.set(`${userId}:${lockedBgId}`, { userId, decorationDefinitionId: lockedBgId, quantity: 1, acquiredSource: "achievement", createdAt: new Date(), updatedAt: new Date() });

    await performEquipDecoration(
      prisma,
      userId,
      { slot: "background", decorationDefinitionId: lockedBgId, idempotencyKey: "equip-shared-key" },
      4 * 60 * 60,
      3,
      new Date(),
      trace
    );

    await expect(
      performEquipDecoration(
        prisma,
        userId,
        { slot: "background", decorationDefinitionId: defaultBgId, idempotencyKey: "equip-shared-key" },
        4 * 60 * 60,
        3,
        new Date(),
        trace
      )
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("rejects equipping a locked decoration", async () => {
    const { prisma, userTanks, userFish } = createMockPrisma();
    userTanks.set(userId, { userId });
    userFish.set(`${userId}:${starterFishId}`, { id: "fish-1", userId, fishDefinitionId: starterFishId, acquiredSource: "starter", displayOrder: 0, createdAt: new Date() });

    await expect(
      performEquipDecoration(
        prisma,
        userId,
        { slot: "background", decorationDefinitionId: lockedBgId, idempotencyKey: "equip-locked" },
        4 * 60 * 60,
        3,
        new Date(),
        trace
      )
    ).rejects.toMatchObject({ code: "DECORATION_LOCKED" });
  });

  it("rejects equipping into a wrong slot", async () => {
    const { prisma, userTanks, userFish, ownedDecorations } = createMockPrisma();
    userTanks.set(userId, { userId });
    userFish.set(`${userId}:${starterFishId}`, { id: "fish-1", userId, fishDefinitionId: starterFishId, acquiredSource: "starter", displayOrder: 0, createdAt: new Date() });
    ownedDecorations.set(`${userId}:${lockedPlantId}`, { userId, decorationDefinitionId: lockedPlantId, quantity: 1, acquiredSource: "achievement", createdAt: new Date(), updatedAt: new Date() });

    await expect(
      performEquipDecoration(
        prisma,
        userId,
        { slot: "background", decorationDefinitionId: lockedPlantId, idempotencyKey: "equip-wrong-slot" },
        4 * 60 * 60,
        3,
        new Date(),
        trace
      )
    ).rejects.toMatchObject({ code: "WRONG_DECORATION_SLOT" });
  });
});

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
