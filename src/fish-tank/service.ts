import { createHash } from "crypto";
import type {
  FishCareEvent,
  FishDefinition,
  FishHatchEvent,
  Prisma,
  TankDecorationDefinition,
  TankDecorationSlot,
  UserFish
} from "@prisma/client";
import type { TraceContext } from "../observability/ids.js";
import {
  debitHatchProgress,
  FishTankResourceError,
  getHatchProgressBalance,
  getResourceSummary,
  type FishTankResourceSummary
} from "./resources.js";

export type TankMood = {
  code: string;
  title: string;
  copy: string;
  ambientArtKey: string;
};

export type EquippedDecoration = {
  slot: string;
  definitionId: string;
  code: string;
  name: string;
  type: string;
  rarity: string;
  artKey: string;
};

export type DecorationInventoryItem = {
  definitionId: string;
  code: string;
  name: string;
  type: string;
  rarity: string;
  artKey: string | null;
  unlockHint: string;
  owned: boolean;
  equipped: boolean;
  slot: string;
};

export type DecorationsSummary = {
  equipped: EquippedDecoration[];
  inventory: DecorationInventoryItem[];
};

export type FishTankSummary = {
  initialized: boolean;
  fish: Array<{
    id: string;
    definitionId: string;
    name: string;
    rarity: string;
    theme: string;
    personality: string;
    artKey: string;
    acquiredSource: string;
    createdAt: string;
  }>;
  careAvailability: {
    feed: {
      available: boolean;
      nextAvailableAt: string | null;
      cooldownRemainingSeconds: number;
    };
  };
  hatchAvailability: HatchAvailability;
  collection: FishCollectionSummary;
  mood: TankMood;
  moodCopy: string;
  nextAction: string;
  resourceSummary: FishTankResourceSummary;
  decorations: DecorationsSummary;
};

export type HatchAvailability = {
  available: boolean;
  reason: string;
  currentProgress: number;
  cost: number;
  missingProgress: number;
};

export type FishCollectionSummary = {
  owned: number;
  total: number;
  percent: number;
  complete: boolean;
  items: Array<{
    definitionId: string;
    name: string | null;
    rarity: string | null;
    personality: string | null;
    artKey: string | null;
    sourceHint: string;
    owned: boolean;
  }>;
};

export type CareInteractionInput = {
  interactionType: string;
  idempotencyKey: string;
};

export type CareInteractionResult = {
  success: boolean;
  resultCopy: string;
  tank: FishTankSummary;
};

export type HatchInput = {
  idempotencyKey: string;
};

export type HatchResult = {
  success: boolean;
  replayed: boolean;
  discoveredFish: FishTankSummary["fish"][number] | null;
  cost: number;
  outcomeCode: string;
  resultTitle: string;
  resultCopy: string;
  nextHint: string;
  tank: FishTankSummary;
};

export type EquipDecorationInput = {
  slot: string;
  decorationDefinitionId: string;
  idempotencyKey: string;
};

export type EquipDecorationResult = {
  success: boolean;
  replayed: boolean;
  outcomeCode: string;
  resultTitle: string;
  resultCopy: string;
  equipped: EquippedDecoration;
  tank: FishTankSummary;
};

type PrismaQueryClientLike = Pick<
  Prisma.TransactionClient,
  | "userTank"
  | "userFish"
  | "fishDefinition"
  | "fishCareEvent"
  | "fishTankResourceLedger"
  | "fishHatchEvent"
  | "tankDecorationDefinition"
  | "userTankDecoration"
  | "userTankEquippedDecoration"
  | "tankDecorationEquipEvent"
  | "$queryRaw"
>;

export type PrismaClientLike = PrismaQueryClientLike & {
  $transaction: <T>(fn: (tx: PrismaQueryClientLike) => Promise<T>) => Promise<T>;
};

const SUPPORTED_INTERACTION_TYPES = new Set(["feed"]);

export async function getTankSummary(
  prisma: PrismaQueryClientLike,
  userId: string,
  now: Date,
  feedCooldownSeconds: number,
  hatchProgressCost: number
): Promise<FishTankSummary> {
  const [tank, fishRows, latestFeedEvent, latestHatchEvent] = await Promise.all([
    prisma.userTank.findUnique({ where: { userId } }),
    prisma.userFish.findMany({
      where: { userId },
      include: { definition: true },
      orderBy: { displayOrder: "asc" }
    }),
    prisma.fishCareEvent.findFirst({
      where: { userId, interactionType: "feed" },
      orderBy: { createdAt: "desc" }
    }),
    prisma.fishHatchEvent.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" }
    })
  ]);

  const initialized = Boolean(tank);
  const careAvailability = buildCareAvailability(latestFeedEvent, now, feedCooldownSeconds);
  const resourceSummary = await getResourceSummary(prisma, userId);
  const collection = await buildCollection(prisma, userId, fishRows);
  const hatchAvailability = buildHatchAvailability({
    initialized,
    hatchProgressCost,
    currentProgress: resourceSummary.totalHatchProgress,
    collection
  });
  const decorations = await buildDecorationsSummary(prisma, userId, initialized);
  const mood = deriveMood({
    initialized,
    fishCount: fishRows.length,
    latestFeedEvent,
    latestHatchEvent,
    now,
    careAvailability,
    hatchAvailability
  });

  return {
    initialized,
    fish: fishRows.map(serializeFish),
    careAvailability,
    hatchAvailability,
    collection,
    mood,
    moodCopy: mood.copy,
    nextAction: deriveNextAction({ initialized, careAvailability, hatchAvailability, decorations }),
    resourceSummary,
    decorations
  };
}

export async function initializeTank(
  prisma: PrismaQueryClientLike,
  userId: string,
  starterFishCode: string,
  feedCooldownSeconds: number,
  hatchProgressCost: number,
  now: Date,
  trace: TraceContext
): Promise<{ summary: FishTankSummary; created: boolean }> {
  const existingTank = await prisma.userTank.findUnique({ where: { userId } });
  const starterDefinition = await prisma.fishDefinition.findUnique({
    where: { code: starterFishCode }
  });

  if (!starterDefinition || !starterDefinition.active) {
    throw new FishTankError("STARTER_FISH_UNAVAILABLE", "Starter fish is not available");
  }

  await prisma.userTank.upsert({
    where: { userId },
    create: { userId },
    update: {}
  });

  await prisma.userFish.upsert({
    where: {
      userId_fishDefinitionId: {
        userId,
        fishDefinitionId: starterDefinition.id
      }
    },
    create: {
      userId,
      fishDefinitionId: starterDefinition.id,
      acquiredSource: "starter",
      displayOrder: 0
    },
    update: {}
  });

  return {
    summary: await getTankSummary(prisma, userId, now, feedCooldownSeconds, hatchProgressCost),
    created: !existingTank
  };
}

export async function performCareInteraction(
  prisma: PrismaQueryClientLike,
  userId: string,
  input: CareInteractionInput,
  feedCooldownSeconds: number,
  hatchProgressCost: number,
  now: Date,
  trace: TraceContext
): Promise<CareInteractionResult> {
  if (!SUPPORTED_INTERACTION_TYPES.has(input.interactionType)) {
    throw new FishTankError("UNSUPPORTED_INTERACTION", `Interaction type '${input.interactionType}' is not supported`);
  }

  if (!input.idempotencyKey || input.idempotencyKey.length < 8 || input.idempotencyKey.length > 128) {
    throw new FishTankError("INVALID_IDEMPOTENCY_KEY", "Idempotency key must be between 8 and 128 characters");
  }

  const existingEvent = await prisma.fishCareEvent.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } }
  });

  if (existingEvent) {
    const summary = await getTankSummary(prisma, userId, now, feedCooldownSeconds, hatchProgressCost);
    const metadata = existingEvent.resultMetadata as Record<string, unknown>;
    return {
      success: true,
      resultCopy: String(metadata.resultCopy ?? ""),
      tank: summary
    };
  }

  const tank = await prisma.userTank.findUnique({ where: { userId } });
  if (!tank) {
    throw new FishTankError("TANK_NOT_INITIALIZED", "Initialize your fish tank before caring for fish");
  }

  const latestEvent = await prisma.fishCareEvent.findFirst({
    where: { userId, interactionType: input.interactionType },
    orderBy: { createdAt: "desc" }
  });

  const cooldownRemaining = calculateCooldownRemaining(latestEvent, now, feedCooldownSeconds);
  if (cooldownRemaining > 0) {
    const summary = await getTankSummary(prisma, userId, now, feedCooldownSeconds, hatchProgressCost);
    return {
      success: false,
      resultCopy: "它刚刚吃饱，正在假装工作。",
      tank: summary
    };
  }

  const resultCopy = deriveCareResultCopy(input.interactionType);
  await prisma.fishCareEvent.create({
    data: {
      userId,
      interactionType: input.interactionType,
      idempotencyKey: input.idempotencyKey,
      resultMetadata: { resultCopy, interactionType: input.interactionType, requestId: trace.requestId }
    }
  });

  const summary = await getTankSummary(prisma, userId, now, feedCooldownSeconds, hatchProgressCost);
  return { success: true, resultCopy, tank: summary };
}

export class FishTankError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "FishTankError";
  }
}

function serializeFish(row: UserFish & { definition: { id: string; code: string; name: string; rarity: string; theme: string; personality: string; artKey: string } }): FishTankSummary["fish"][number] {
  return {
    id: row.id,
    definitionId: row.definition.id,
    name: row.definition.name,
    rarity: row.definition.rarity,
    theme: row.definition.theme,
    personality: row.definition.personality,
    artKey: row.definition.artKey,
    acquiredSource: row.acquiredSource,
    createdAt: row.createdAt.toISOString()
  };
}

function buildCareAvailability(
  latestEvent: FishCareEvent | null,
  now: Date,
  feedCooldownSeconds: number
): FishTankSummary["careAvailability"] {
  const remaining = calculateCooldownRemaining(latestEvent, now, feedCooldownSeconds);
  const available = remaining <= 0;
  const nextAvailableAt = available
    ? null
    : new Date((latestEvent?.createdAt.getTime() ?? now.getTime()) + feedCooldownSeconds * 1000).toISOString();

  return {
    feed: {
      available,
      nextAvailableAt,
      cooldownRemainingSeconds: Math.max(0, remaining)
    }
  };
}

function calculateCooldownRemaining(
  latestEvent: FishCareEvent | null,
  now: Date,
  cooldownSeconds: number
): number {
  if (!latestEvent) return 0;
  const elapsedSeconds = (now.getTime() - latestEvent.createdAt.getTime()) / 1000;
  return Math.max(0, cooldownSeconds - elapsedSeconds);
}

function deriveMood(input: {
  initialized: boolean;
  fishCount: number;
  latestFeedEvent: FishCareEvent | null;
  latestHatchEvent: FishHatchEvent | null;
  now: Date;
  careAvailability: FishTankSummary["careAvailability"];
  hatchAvailability: HatchAvailability;
}): TankMood {
  if (!input.initialized) {
    return {
      code: "idle",
      title: "等待开缸",
      copy: "这里还空着，放一条小鱼进来，它会替你假装工作。",
      ambientArtKey: "tank-mood-idle"
    };
  }

  if (input.fishCount === 0) {
    return {
      code: "idle",
      title: "空缸待机",
      copy: "鱼缸已经备好，但还没有鱼。",
      ambientArtKey: "tank-mood-idle"
    };
  }

  if (input.hatchAvailability.available) {
    return {
      code: "excited",
      title: "孵化就绪",
      copy: "进度已经攒够，新邻居随时可以登场。",
      ambientArtKey: "tank-mood-excited"
    };
  }

  if (input.latestHatchEvent) {
    const minutesSinceHatch = Math.floor(
      (input.now.getTime() - input.latestHatchEvent.createdAt.getTime()) / 60000
    );
    if (minutesSinceHatch < 10) {
      return {
        code: "sparkly",
        title: "新鱼光临",
        copy: "新邻居刚刚游进缸里，水面都亮了一点。",
        ambientArtKey: "tank-mood-sparkly"
      };
    }
  }

  const minutesSinceFeed = input.latestFeedEvent
    ? Math.floor((input.now.getTime() - input.latestFeedEvent.createdAt.getTime()) / 60000)
    : null;

  if (minutesSinceFeed !== null && minutesSinceFeed < 5) {
    return {
      code: "cozy",
      title: "吃饱发呆",
      copy: "它刚刚吃饱，现在正贴着缸壁发呆。",
      ambientArtKey: "tank-mood-cozy"
    };
  }

  if (input.fishCount >= 3) {
    return {
      code: "sleepy",
      title: "鱼群打盹",
      copy: "小鱼们挤在一起，对 KPI 完全没有意见。",
      ambientArtKey: "tank-mood-sleepy"
    };
  }

  return {
    code: "idle",
    title: "一起发呆",
    copy: "小鱼游得很慢，看起来对 KPI 没有意见。",
    ambientArtKey: "tank-mood-idle"
  };
}

function deriveNextAction(input: {
  initialized: boolean;
  careAvailability: FishTankSummary["careAvailability"];
  hatchAvailability: HatchAvailability;
  decorations: DecorationsSummary;
}): string {
  if (!input.initialized) {
    return "initialize";
  }
  if (input.careAvailability.feed.available) {
    return "feed";
  }
  if (input.hatchAvailability.available) {
    return "hatch";
  }
  const hasActionableDecor = input.decorations.inventory.some(
    (item) => item.owned && !item.equipped && item.slot === item.type
  );
  if (hasActionableDecor) {
    return "decor";
  }
  return "wait";
}

function deriveCareResultCopy(interactionType: string): string {
  if (interactionType === "feed") {
    return "投喂成功，小鱼看起来很满意。";
  }
  return "互动完成。";
}

async function buildCollection(
  prisma: PrismaQueryClientLike,
  userId: string,
  ownedFishRows: Array<UserFish & { definition: { id: string; code: string; name: string; rarity: string; theme: string; personality: string; artKey: string; sourceHint: string; active: boolean } }>
): Promise<FishCollectionSummary> {
  const allDefinitions = await prisma.fishDefinition.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" }
  });

  const ownedDefinitionIds = new Set(ownedFishRows.map((row) => row.definition.id));
  const items = allDefinitions.map((definition) =>
    serializeCollectionItem(definition, ownedDefinitionIds.has(definition.id))
  );

  const owned = items.filter((item) => item.owned).length;
  const total = items.length;

  return {
    owned,
    total,
    percent: total > 0 ? Math.round((owned / total) * 100) : 0,
    complete: total > 0 && owned === total,
    items
  };
}

function serializeCollectionItem(
  definition: FishDefinition,
  owned: boolean
): FishCollectionSummary["items"][number] {
  if (owned) {
    return {
      definitionId: definition.id,
      name: definition.name,
      rarity: definition.rarity,
      personality: definition.personality,
      artKey: definition.artKey,
      sourceHint: definition.sourceHint,
      owned: true
    };
  }

  return {
    definitionId: definition.id,
    name: null,
    rarity: null,
    personality: null,
    artKey: null,
    sourceHint: definition.sourceHint,
    owned: false
  };
}

function buildHatchAvailability(input: {
  initialized: boolean;
  hatchProgressCost: number;
  currentProgress: number;
  collection: FishCollectionSummary;
}): HatchAvailability {
  if (!input.initialized) {
    return {
      available: false,
      reason: "tank_not_initialized",
      currentProgress: input.currentProgress,
      cost: input.hatchProgressCost,
      missingProgress: Math.max(0, input.hatchProgressCost - input.currentProgress)
    };
  }

  if (input.collection.complete) {
    return {
      available: false,
      reason: "catalog_complete",
      currentProgress: input.currentProgress,
      cost: input.hatchProgressCost,
      missingProgress: 0
    };
  }

  if (input.currentProgress < input.hatchProgressCost) {
    return {
      available: false,
      reason: "insufficient_progress",
      currentProgress: input.currentProgress,
      cost: input.hatchProgressCost,
      missingProgress: input.hatchProgressCost - input.currentProgress
    };
  }

  return {
    available: true,
    reason: "ready",
    currentProgress: input.currentProgress,
    cost: input.hatchProgressCost,
    missingProgress: 0
  };
}

const DEFAULT_DECORATION_CODES = new Set([
  "default_tank_background",
  "default_tank_plant",
  "default_tank_prop_empty",
  "default_tank_ambient_bubbles"
]);

const SLOT_ORDER: Record<string, number> = {
  background: 1,
  plant: 2,
  prop: 3,
  ambient: 4
};

function isAllowedDefaultDecoration(code: string): boolean {
  return DEFAULT_DECORATION_CODES.has(code);
}

async function buildDecorationsSummary(
  prisma: PrismaQueryClientLike,
  userId: string,
  initialized: boolean
): Promise<DecorationsSummary> {
  if (!initialized) {
    return { equipped: [], inventory: [] };
  }

  const [activeDefinitions, ownedDecorations, equippedDecorations] = await Promise.all([
    prisma.tankDecorationDefinition.findMany({
      where: { active: true },
      orderBy: [{ type: "asc" }, { sortOrder: "asc" }]
    }),
    prisma.userTankDecoration.findMany({
      where: { userId }
    }),
    prisma.userTankEquippedDecoration.findMany({
      where: { userId }
    })
  ]);

  const activeDefinitionIds = new Set(activeDefinitions.map((definition) => definition.id));
  const historicalDefinitions = await Promise.all(
    equippedDecorations
      .filter((row) => !activeDefinitionIds.has(row.decorationDefinitionId))
      .map((row) =>
        prisma.tankDecorationDefinition.findUnique({
          where: { id: row.decorationDefinitionId }
        })
      )
  );
  const allDefinitions = [
    ...activeDefinitions,
    ...historicalDefinitions.filter(
      (definition): definition is TankDecorationDefinition => definition !== null
    )
  ];

  const definitionById = new Map<string, TankDecorationDefinition>();
  for (const definition of allDefinitions) {
    definitionById.set(definition.id, definition);
  }

  const ownedDefinitionIds = new Set(ownedDecorations.map((row) => row.decorationDefinitionId));
  const equippedBySlot = new Map<string, TankDecorationDefinition>();
  for (const row of equippedDecorations) {
    const definition = definitionById.get(row.decorationDefinitionId);
    if (definition) {
      equippedBySlot.set(row.slot, definition);
    }
  }

  const defaultBySlot = new Map<string, TankDecorationDefinition>();
  for (const definition of activeDefinitions) {
    if (isAllowedDefaultDecoration(definition.code) && !defaultBySlot.has(definition.type)) {
      defaultBySlot.set(definition.type, definition);
    }
  }

  const equipped: EquippedDecoration[] = [];
  for (const slot of Object.keys(SLOT_ORDER).sort((a, b) => SLOT_ORDER[a] - SLOT_ORDER[b])) {
    const definition = equippedBySlot.get(slot) ?? defaultBySlot.get(slot);
    if (definition) {
      equipped.push(serializeEquippedDecoration(definition, slot));
    }
  }

  const inventory: DecorationInventoryItem[] = activeDefinitions.map((definition) => {
    const owned = ownedDefinitionIds.has(definition.id) || isAllowedDefaultDecoration(definition.code);
    const equippedSlot = equipped.find((item) => item.definitionId === definition.id)?.slot ?? null;
    return serializeDecorationInventoryItem(definition, owned, equippedSlot);
  });

  return { equipped, inventory };
}

function serializeEquippedDecoration(
  definition: TankDecorationDefinition,
  slot: string
): EquippedDecoration {
  return {
    slot,
    definitionId: definition.id,
    code: definition.code,
    name: definition.name,
    type: definition.type,
    rarity: definition.rarity,
    artKey: definition.artKey
  };
}

function serializeDecorationInventoryItem(
  definition: TankDecorationDefinition,
  owned: boolean,
  equippedSlot: string | null
): DecorationInventoryItem {
  return {
    definitionId: definition.id,
    code: definition.code,
    name: definition.name,
    type: definition.type,
    rarity: definition.rarity,
    artKey: owned ? definition.artKey : null,
    unlockHint: definition.unlockHint,
    owned,
    equipped: equippedSlot !== null,
    slot: equippedSlot ?? definition.type
  };
}

export async function performEquipDecoration(
  prisma: PrismaClientLike,
  userId: string,
  input: EquipDecorationInput,
  feedCooldownSeconds: number,
  hatchProgressCost: number,
  now: Date,
  trace: TraceContext
): Promise<EquipDecorationResult> {
  if (!input.idempotencyKey || input.idempotencyKey.length < 8 || input.idempotencyKey.length > 128) {
    throw new FishTankError("INVALID_IDEMPOTENCY_KEY", "Idempotency key must be between 8 and 128 characters");
  }

  const validSlots = new Set(Object.keys(SLOT_ORDER));
  if (!validSlots.has(input.slot)) {
    throw new FishTankError("INVALID_DECORATION_SLOT", `Decoration slot '${input.slot}' is not valid`);
  }
  const slot = input.slot as TankDecorationSlot;

  const existingEvent = await prisma.tankDecorationEquipEvent.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } }
  });

  if (existingEvent) {
    assertEquipEventMatchesInput(existingEvent, input);
    return buildEquipReplayResult(existingEvent);
  }

  const tank = await prisma.userTank.findUnique({ where: { userId } });
  if (!tank) {
    throw new FishTankError("TANK_NOT_INITIALIZED", "Initialize your fish tank before equipping decorations");
  }

  const definition = await prisma.tankDecorationDefinition.findUnique({
    where: { id: input.decorationDefinitionId }
  });

  if (!definition || !definition.active) {
    throw new FishTankError(
      "DECORATION_NOT_FOUND",
      "The requested decoration does not exist or is no longer available"
    );
  }

  if (definition.type !== slot) {
    throw new FishTankError(
      "WRONG_DECORATION_SLOT",
      `Decoration '${definition.name}' cannot be equipped in slot '${slot}'`
    );
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT * FROM user_tanks WHERE user_id = ${userId}::uuid FOR UPDATE`;

    const existingEventAfterLock = await tx.tankDecorationEquipEvent.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } }
    });

    if (existingEventAfterLock) {
      assertEquipEventMatchesInput(existingEventAfterLock, input);
      return buildEquipReplayResult(existingEventAfterLock);
    }

    const ownership = await tx.userTankDecoration.findUnique({
      where: {
        userId_decorationDefinitionId: {
          userId,
          decorationDefinitionId: definition.id
        }
      }
    });

    if (!ownership && !isAllowedDefaultDecoration(definition.code)) {
      throw new FishTankError("DECORATION_LOCKED", "You do not own this decoration");
    }

    await tx.userTankEquippedDecoration.upsert({
      where: {
        userId_slot: {
          userId,
          slot
        }
      },
      create: {
        userId,
        slot,
        decorationDefinitionId: definition.id
      },
      update: {
        decorationDefinitionId: definition.id,
        equippedAt: now
      }
    });

    const summary = await getTankSummary(tx, userId, now, feedCooldownSeconds, hatchProgressCost);
    const resultTitle = "装扮已更换";
    const resultCopy = `${definition.name} 已经放进鱼缸的 ${slotLabel(slot)} 位置。`;
    const equipped = serializeEquippedDecoration(definition, slot);

    const equipEvent = await tx.tankDecorationEquipEvent.create({
      data: {
        userId,
        slot,
        decorationDefinitionId: definition.id,
        idempotencyKey: input.idempotencyKey,
        outcomeCode: "EQUIPPED",
        replay: false,
        resultMetadata: {
          decorationCode: definition.code,
          decorationName: definition.name,
          slot,
          resultTitle,
          resultCopy,
          equipped,
          tank: summary,
          requestId: trace.requestId
        }
      }
    });

    return {
      success: true,
      replayed: false,
      outcomeCode: equipEvent.outcomeCode,
      resultTitle,
      resultCopy,
      equipped,
      tank: summary
    };
  });
}

function slotLabel(slot: string): string {
  switch (slot) {
    case "background":
      return "背景";
    case "plant":
      return "水草";
    case "prop":
      return "小景";
    case "ambient":
      return "水景";
    default:
      return slot;
  }
}

function buildEquipReplayResult(event: {
  outcomeCode: string;
  resultMetadata: Prisma.JsonValue;
}): EquipDecorationResult {
  const metadata = event.resultMetadata as Record<string, unknown>;
  const equipped = metadata.equipped as EquippedDecoration | undefined;
  const tank = metadata.tank as FishTankSummary | undefined;
  if (!equipped || !tank || typeof metadata.resultTitle !== "string" || typeof metadata.resultCopy !== "string") {
    throw new FishTankError("DECORATION_REPLAY_MISSING", "Could not reconstruct replay result");
  }

  return {
    success: event.outcomeCode === "EQUIPPED",
    replayed: true,
    outcomeCode: event.outcomeCode,
    resultTitle: metadata.resultTitle,
    resultCopy: metadata.resultCopy,
    equipped,
    tank
  };
}

function assertEquipEventMatchesInput(
  event: { slot: TankDecorationSlot; decorationDefinitionId: string },
  input: EquipDecorationInput
) {
  if (event.slot !== input.slot || event.decorationDefinitionId !== input.decorationDefinitionId) {
    throw new FishTankError(
      "IDEMPOTENCY_KEY_REUSED",
      "Idempotency key was already used for a different decoration command"
    );
  }
}

export async function performHatch(
  prisma: PrismaClientLike,
  userId: string,
  input: HatchInput,
  hatchProgressCost: number,
  feedCooldownSeconds: number,
  now: Date,
  trace: TraceContext
): Promise<HatchResult> {
  if (!input.idempotencyKey || input.idempotencyKey.length < 8 || input.idempotencyKey.length > 128) {
    throw new FishTankError("INVALID_IDEMPOTENCY_KEY", "Idempotency key must be between 8 and 128 characters");
  }

  const tank = await prisma.userTank.findUnique({ where: { userId } });
  if (!tank) {
    throw new FishTankError("TANK_NOT_INITIALIZED", "Initialize your fish tank before hatching");
  }

  const existingEvent = await prisma.fishHatchEvent.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } }
  });

  if (existingEvent) {
    return buildHatchReplayResult(prisma, userId, existingEvent, now, feedCooldownSeconds, hatchProgressCost);
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT * FROM user_tanks WHERE user_id = ${userId}::uuid FOR UPDATE`;

    const existingEventAfterLock = await tx.fishHatchEvent.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } }
    });

    if (existingEventAfterLock) {
      return buildHatchReplayResult(
        tx,
        userId,
        existingEventAfterLock,
        now,
        feedCooldownSeconds,
        hatchProgressCost
      );
    }

    const currentProgress = await getHatchProgressBalance(tx, userId);
    if (currentProgress < hatchProgressCost) {
      const summary = await getTankSummary(tx, userId, now, feedCooldownSeconds, hatchProgressCost);
      return {
        success: false,
        replayed: false,
        discoveredFish: null,
        cost: 0,
        outcomeCode: "INSUFFICIENT_HATCH_PROGRESS",
        resultTitle: "孵化进度不足",
        resultCopy: `还需要 ${hatchProgressCost - currentProgress} 点孵化进度才能召唤新邻居。`,
        nextHint: "去抽豆或完成活动，继续攒孵化进度。",
        tank: summary
      };
    }

    const ownedFishRows = await tx.userFish.findMany({
      where: { userId },
      select: { fishDefinitionId: true }
    });
    const ownedDefinitionIds = new Set(ownedFishRows.map((row) => row.fishDefinitionId));

    const eligibleDefinitions = await tx.fishDefinition.findMany({
      where: {
        active: true,
        NOT: { code: "starter_goldfish" }
      },
      orderBy: { sortOrder: "asc" }
    });

    const undiscovered = eligibleDefinitions.filter((def) => !ownedDefinitionIds.has(def.id));

    if (undiscovered.length === 0) {
      const summary = await getTankSummary(tx, userId, now, feedCooldownSeconds, hatchProgressCost);
      return {
        success: false,
        replayed: false,
        discoveredFish: null,
        cost: 0,
        outcomeCode: "FISH_CATALOG_COMPLETE",
        resultTitle: "图鉴已集齐",
        resultCopy: "当前所有可召唤的鱼都已经在缸里，等新鱼加入吧。",
        nextHint: "继续照顾现有的小鱼。",
        tank: summary
      };
    }

    const selectedDefinition = selectHatchCandidate(undiscovered, userId, input.idempotencyKey);

    const existingOwnership = await tx.userFish.findUnique({
      where: { userId_fishDefinitionId: { userId, fishDefinitionId: selectedDefinition.id } }
    });

    if (existingOwnership) {
      const summary = await getTankSummary(tx, userId, now, feedCooldownSeconds, hatchProgressCost);
      return {
        success: true,
        replayed: false,
        discoveredFish: serializeFish({
          ...existingOwnership,
          definition: selectedDefinition
        }),
        cost: 0,
        outcomeCode: "ALREADY_OWNED",
        resultTitle: "这条鱼已经在缸里",
        resultCopy: "它早就住进来了，进度没有变化。",
        nextHint: "看看鱼缸或者继续攒进度。",
        tank: summary
      };
    }

    const hatchEvent = await tx.fishHatchEvent.create({
      data: {
        userId,
        fishDefinitionId: selectedDefinition.id,
        idempotencyKey: input.idempotencyKey,
        hatchCost: hatchProgressCost,
        outcomeCode: "DISCOVERED",
        duplicate: false,
        resultMetadata: {
          fishCode: selectedDefinition.code,
          fishName: selectedDefinition.name,
          requestId: trace.requestId
        }
      }
    });

    await debitHatchProgress(tx, userId, {
      cost: hatchProgressCost,
      hatchEventId: hatchEvent.id,
      idempotencyKey: input.idempotencyKey
    });

    const userFish = await tx.userFish.create({
      data: {
        userId,
        fishDefinitionId: selectedDefinition.id,
        acquiredSource: "hatch",
        displayOrder: ownedFishRows.length
      },
      include: { definition: true }
    });

    const summary = await getTankSummary(tx, userId, now, feedCooldownSeconds, hatchProgressCost);
    return {
      success: true,
      replayed: false,
      discoveredFish: serializeFish(userFish),
      cost: hatchProgressCost,
      outcomeCode: "DISCOVERED",
      resultTitle: "新鱼登场",
      resultCopy: `${selectedDefinition.name} 从进度里游了出来，鱼缸又热闹了一点。`,
      nextHint: "返回鱼缸看看新邻居，或者继续攒进度。",
      tank: summary
    };
  });
}

function selectHatchCandidate(
  eligibleDefinitions: FishDefinition[],
  userId: string,
  idempotencyKey: string
): FishDefinition {
  const hash = createHash("sha256")
    .update(`${userId}:${idempotencyKey}`)
    .digest("hex");
  const index = Number.parseInt(hash.slice(0, 16), 16) % eligibleDefinitions.length;
  return eligibleDefinitions[index];
}

async function buildHatchReplayResult(
  prisma: PrismaQueryClientLike,
  userId: string,
  event: FishHatchEvent,
  now: Date,
  feedCooldownSeconds: number,
  hatchProgressCost: number
): Promise<HatchResult> {
  const [summary, ownership] = await Promise.all([
    getTankSummary(prisma, userId, now, feedCooldownSeconds, hatchProgressCost),
    prisma.userFish.findUnique({
      where: {
        userId_fishDefinitionId: {
          userId,
          fishDefinitionId: event.fishDefinitionId
        }
      },
      include: { definition: true }
    })
  ]);

  return {
    success: true,
    replayed: true,
    discoveredFish: ownership ? serializeFish(ownership) : null,
    cost: event.hatchCost,
    outcomeCode: event.outcomeCode,
    resultTitle: "孵化结果已保存",
    resultCopy: "这条鱼已经在你缸里了，不用再花进度。",
    nextHint: "看看鱼缸或者继续攒进度。",
    tank: summary
  };
}
