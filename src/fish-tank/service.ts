import type { FishCareEvent, Prisma, UserFish } from "@prisma/client";
import type { TraceContext } from "../observability/ids.js";

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
  moodCopy: string;
  nextAction: string;
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

type PrismaClientLike = Pick<
  Prisma.TransactionClient,
  "userTank" | "userFish" | "fishDefinition" | "fishCareEvent"
>;

const SUPPORTED_INTERACTION_TYPES = new Set(["feed"]);

export async function getTankSummary(
  prisma: PrismaClientLike,
  userId: string,
  now: Date,
  feedCooldownSeconds: number
): Promise<FishTankSummary> {
  const [tank, fishRows, latestFeedEvent] = await Promise.all([
    prisma.userTank.findUnique({ where: { userId } }),
    prisma.userFish.findMany({
      where: { userId },
      include: { definition: true },
      orderBy: { displayOrder: "asc" }
    }),
    prisma.fishCareEvent.findFirst({
      where: { userId, interactionType: "feed" },
      orderBy: { createdAt: "desc" }
    })
  ]);

  const initialized = Boolean(tank);
  const careAvailability = buildCareAvailability(latestFeedEvent, now, feedCooldownSeconds);

  return {
    initialized,
    fish: fishRows.map(serializeFish),
    careAvailability,
    moodCopy: deriveMoodCopy({ initialized, fishCount: fishRows.length, latestFeedEvent, now, careAvailability }),
    nextAction: deriveNextAction({ initialized, careAvailability })
  };
}

export async function initializeTank(
  prisma: PrismaClientLike,
  userId: string,
  starterFishCode: string,
  feedCooldownSeconds: number,
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
    summary: await getTankSummary(prisma, userId, now, feedCooldownSeconds),
    created: !existingTank
  };
}

export async function performCareInteraction(
  prisma: PrismaClientLike,
  userId: string,
  input: CareInteractionInput,
  feedCooldownSeconds: number,
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
    const summary = await getTankSummary(prisma, userId, now, feedCooldownSeconds);
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
    const summary = await getTankSummary(prisma, userId, now, feedCooldownSeconds);
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

  const summary = await getTankSummary(prisma, userId, now, feedCooldownSeconds);
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

function deriveMoodCopy(input: {
  initialized: boolean;
  fishCount: number;
  latestFeedEvent: FishCareEvent | null;
  now: Date;
  careAvailability: FishTankSummary["careAvailability"];
}): string {
  if (!input.initialized) {
    return "这里还空着，放一条小鱼进来，它会替你假装工作。";
  }

  if (input.fishCount === 0) {
    return "鱼缸已经备好，但还没有鱼。";
  }

  if (input.careAvailability.feed.available) {
    return "小鱼晃了晃尾巴，像是在问今天有没有零食。";
  }

  const minutesSinceFeed = input.latestFeedEvent
    ? Math.floor((input.now.getTime() - input.latestFeedEvent.createdAt.getTime()) / 60000)
    : null;

  if (minutesSinceFeed !== null && minutesSinceFeed < 5) {
    return "它刚刚吃饱，现在正贴着缸壁发呆。";
  }

  return "小鱼游得很慢，看起来对 KPI 没有意见。";
}

function deriveNextAction(input: {
  initialized: boolean;
  careAvailability: FishTankSummary["careAvailability"];
}): string {
  if (!input.initialized) {
    return "initialize";
  }
  if (input.careAvailability.feed.available) {
    return "feed";
  }
  return "wait";
}

function deriveCareResultCopy(interactionType: string): string {
  if (interactionType === "feed") {
    return "投喂成功，小鱼看起来很满意。";
  }
  return "互动完成。";
}
