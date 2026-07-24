import { FishTankResourceType, type Prisma } from "@prisma/client";
import type { ExistingLoopRewardsConfig } from "../config/runtime.js";

export { FishTankResourceType };

export type FishTankResourceOutcome = {
  resourceType: FishTankResourceType;
  quantity: number;
  label: string;
  copy: string;
};

export type FishTankResourceSummary = {
  resources: Array<{
    resourceType: FishTankResourceType;
    quantity: number;
    label: string;
  }>;
  totalFood: number;
  totalBubbles: number;
  totalHatchProgress: number;
};

export type ExistingRewardSourceType =
  | "check_in_finish"
  | "activity_completion"
  | "daily_goal_claim"
  | "weekly_goal_claim";

export type ExistingLoopGrantMetadata = {
  policyVersion: string;
  sourceType: ExistingRewardSourceType;
  resourceType: FishTankResourceType;
  quantity: number;
  label: string;
  copy: string;
  requestId?: string;
  traceId?: string;
};

type PrismaClientLike = Pick<Prisma.TransactionClient, "fishTankResourceLedger">;

export const resourceLabels: Record<FishTankResourceType, string> = {
  [FishTankResourceType.food]: "鱼食",
  [FishTankResourceType.bubble]: "气泡",
  [FishTankResourceType.hatch_progress]: "孵化进度"
};

function resourceCopy(resourceType: FishTankResourceType, quantity: number): string {
  if (resourceType === FishTankResourceType.food) {
    return `重复豆没有白来，鱼缸库存 +${quantity}。`;
  }
  if (resourceType === FishTankResourceType.bubble) {
    return `气泡 +${quantity}：鱼缸看起来更像在认真摸鱼。`;
  }
  return `孵化进度 +${quantity}：新邻居正在路上。`;
}

const existingRewardSourceLabels: Record<ExistingRewardSourceType, string> = {
  check_in_finish: "打卡",
  activity_completion: "活动",
  daily_goal_claim: "每日目标",
  weekly_goal_claim: "每周目标"
};

function existingRewardCopy(
  sourceType: ExistingRewardSourceType,
  resourceType: FishTankResourceType,
  quantity: number
): string {
  const sourceLabel = existingRewardSourceLabels[sourceType];
  const resourceLabel = resourceLabels[resourceType];
  return `${sourceLabel}完成，${resourceLabel} +${quantity}。`;
}

export function resolveExistingLoopOutcomes(
  sourceType: ExistingRewardSourceType,
  config: ExistingLoopRewardsConfig
): FishTankResourceOutcome[] {
  const sourceConfig = config.sources[sourceKeyForSourceType(sourceType)];
  if (!sourceConfig || sourceConfig.length === 0) {
    return [];
  }

  return sourceConfig.map((outcome) => ({
    resourceType: mapResourceType(outcome.resourceType),
    quantity: outcome.quantity,
    label: resourceLabels[mapResourceType(outcome.resourceType)],
    copy: existingRewardCopy(sourceType, mapResourceType(outcome.resourceType), outcome.quantity)
  }));
}

function sourceKeyForSourceType(
  sourceType: ExistingRewardSourceType
): keyof ExistingLoopRewardsConfig["sources"] {
  switch (sourceType) {
    case "check_in_finish":
      return "checkInFinish";
    case "activity_completion":
      return "activityCompletion";
    case "daily_goal_claim":
      return "dailyGoalClaim";
    case "weekly_goal_claim":
      return "weeklyGoalClaim";
  }
}

function mapResourceType(value: "food" | "bubble" | "hatch_progress"): FishTankResourceType {
  switch (value) {
    case "food":
      return FishTankResourceType.food;
    case "bubble":
      return FishTankResourceType.bubble;
    case "hatch_progress":
      return FishTankResourceType.hatch_progress;
  }
}

export function computeBeanDrawOutcomes(input: {
  rarity: string;
  duplicate: boolean;
  pityTriggered: boolean;
}): FishTankResourceOutcome[] {
  const outcomes: FishTankResourceOutcome[] = [];

  outcomes.push({
    resourceType: FishTankResourceType.bubble,
    quantity: 1,
    label: resourceLabels[FishTankResourceType.bubble],
    copy: resourceCopy(FishTankResourceType.bubble, 1)
  });

  if (!input.duplicate) {
    outcomes.push({
      resourceType: FishTankResourceType.hatch_progress,
      quantity: 1,
      label: resourceLabels[FishTankResourceType.hatch_progress],
      copy: resourceCopy(FishTankResourceType.hatch_progress, 1)
    });
    if (input.pityTriggered) {
      outcomes.push({
        resourceType: FishTankResourceType.food,
        quantity: 2,
        label: resourceLabels[FishTankResourceType.food],
        copy: resourceCopy(FishTankResourceType.food, 2)
      });
    }
  } else if (input.pityTriggered || ["rare", "epic", "legendary"].includes(input.rarity)) {
    outcomes.push({
      resourceType: FishTankResourceType.food,
      quantity: 2,
      label: resourceLabels[FishTankResourceType.food],
      copy: resourceCopy(FishTankResourceType.food, 2)
    });
  } else {
    outcomes.push({
      resourceType: FishTankResourceType.food,
      quantity: 1,
      label: resourceLabels[FishTankResourceType.food],
      copy: resourceCopy(FishTankResourceType.food, 1)
    });
  }

  return outcomes;
}

export async function grantResourcesFromBeanDraw(
  prisma: PrismaClientLike,
  userId: string,
  input: {
    drawIdempotencyKey: string;
    rarity: string;
    duplicate: boolean;
    pityTriggered: boolean;
  }
): Promise<FishTankResourceOutcome[]> {
  const outcomes = computeBeanDrawOutcomes(input);
  if (outcomes.length === 0) {
    return outcomes;
  }

  const sourceType = "bean_draw";
  const sourceId = null;

  for (const outcome of outcomes) {
    const idempotencyKey = `${input.drawIdempotencyKey}:${outcome.resourceType}`;
    await prisma.fishTankResourceLedger.upsert({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
      create: {
        userId,
        resourceType: outcome.resourceType,
        quantity: outcome.quantity,
        sourceType,
        sourceId,
        idempotencyKey,
        metadata: {
          rarity: input.rarity,
          duplicate: input.duplicate,
          pityTriggered: input.pityTriggered
        }
      },
      update: {}
    });
  }

  return outcomes;
}

export async function grantExistingLoopRewards(
  prisma: PrismaClientLike,
  userId: string,
  input: {
    sourceType: ExistingRewardSourceType;
    sourceId: string;
    policyVersion: string;
    outcomes: FishTankResourceOutcome[];
    requestId?: string;
    traceId?: string;
  }
): Promise<FishTankResourceOutcome[]> {
  if (input.outcomes.length === 0) {
    return [];
  }

  const granted: FishTankResourceOutcome[] = [];

  for (const outcome of input.outcomes) {
    const idempotencyKey = `existing_reward:${input.sourceType}:${input.sourceId}:${outcome.resourceType}:${input.policyVersion}`;
    const metadata: ExistingLoopGrantMetadata = {
      policyVersion: input.policyVersion,
      sourceType: input.sourceType,
      resourceType: outcome.resourceType,
      quantity: outcome.quantity,
      label: outcome.label,
      copy: outcome.copy,
      requestId: input.requestId,
      traceId: input.traceId
    };

    await prisma.fishTankResourceLedger.upsert({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
      create: {
        userId,
        resourceType: outcome.resourceType,
        quantity: outcome.quantity,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        idempotencyKey,
        metadata
      },
      update: {}
    });

    granted.push(outcome);
  }

  return granted;
}

export async function reconstructExistingLoopOutcomes(
  prisma: PrismaClientLike,
  userId: string,
  input: {
    sourceType: ExistingRewardSourceType;
    sourceId: string;
  }
): Promise<FishTankResourceOutcome[]> {
  const rows = await prisma.fishTankResourceLedger.findMany({
    where: {
      userId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      quantity: { gt: 0 }
    },
    orderBy: { createdAt: "asc" }
  });

  return rows.map((row) => {
    const meta = (row.metadata ?? {}) as Partial<ExistingLoopGrantMetadata>;
    return {
      resourceType: row.resourceType,
      quantity: row.quantity,
      label: meta.label ?? resourceLabels[row.resourceType],
      copy: meta.copy ?? existingRewardCopy(input.sourceType, row.resourceType, row.quantity)
    };
  });
}

export async function getHatchProgressBalance(
  prisma: PrismaClientLike,
  userId: string
): Promise<number> {
  const result = await prisma.fishTankResourceLedger.aggregate({
    where: { userId, resourceType: FishTankResourceType.hatch_progress },
    _sum: { quantity: true }
  });
  return result._sum.quantity ?? 0;
}

export async function debitHatchProgress(
  prisma: PrismaClientLike,
  userId: string,
  input: {
    cost: number;
    hatchEventId: string;
    idempotencyKey: string;
  }
): Promise<{ previousBalance: number; newBalance: number }> {
  const previousBalance = await getHatchProgressBalance(prisma, userId);
  if (previousBalance < input.cost) {
    throw new FishTankResourceError("INSUFFICIENT_HATCH_PROGRESS", "Not enough hatch progress");
  }

  const ledgerIdempotencyKey = `hatch_debit:${input.idempotencyKey}`;

  await prisma.fishTankResourceLedger.upsert({
    where: { userId_idempotencyKey: { userId, idempotencyKey: ledgerIdempotencyKey } },
    create: {
      userId,
      resourceType: FishTankResourceType.hatch_progress,
      quantity: -input.cost,
      sourceType: "hatch",
      sourceId: input.hatchEventId,
      idempotencyKey: ledgerIdempotencyKey,
      metadata: { hatchEventId: input.hatchEventId, cost: input.cost }
    },
    update: {}
  });

  const newBalance = previousBalance - input.cost;
  return { previousBalance, newBalance };
}

export async function getFoodBalance(prisma: PrismaClientLike, userId: string): Promise<number> {
  const result = await prisma.fishTankResourceLedger.aggregate({
    where: { userId, resourceType: FishTankResourceType.food },
    _sum: { quantity: true }
  });
  return result._sum.quantity ?? 0;
}

export async function getBubbleBalance(prisma: PrismaClientLike, userId: string): Promise<number> {
  const result = await prisma.fishTankResourceLedger.aggregate({
    where: { userId, resourceType: FishTankResourceType.bubble },
    _sum: { quantity: true }
  });
  return result._sum.quantity ?? 0;
}

export async function debitFood(
  prisma: PrismaClientLike,
  userId: string,
  input: {
    cost: number;
    careEventId: string;
    idempotencyKey: string;
  }
): Promise<{ previousBalance: number; newBalance: number }> {
  const previousBalance = await getFoodBalance(prisma, userId);
  if (previousBalance < input.cost) {
    throw new FishTankResourceError("INSUFFICIENT_FOOD", "Not enough food");
  }

  const ledgerIdempotencyKey = `care_feed:${input.idempotencyKey}`;

  await prisma.fishTankResourceLedger.upsert({
    where: { userId_idempotencyKey: { userId, idempotencyKey: ledgerIdempotencyKey } },
    create: {
      userId,
      resourceType: FishTankResourceType.food,
      quantity: -input.cost,
      sourceType: "care_feed",
      sourceId: input.careEventId,
      idempotencyKey: ledgerIdempotencyKey,
      metadata: { careEventId: input.careEventId, cost: input.cost }
    },
    update: {}
  });

  const newBalance = previousBalance - input.cost;
  return { previousBalance, newBalance };
}

export async function debitBubble(
  prisma: PrismaClientLike,
  userId: string,
  input: {
    cost: number;
    careEventId: string;
    idempotencyKey: string;
  }
): Promise<{ previousBalance: number; newBalance: number }> {
  const previousBalance = await getBubbleBalance(prisma, userId);
  if (previousBalance < input.cost) {
    throw new FishTankResourceError("INSUFFICIENT_BUBBLE", "Not enough bubble");
  }

  const ledgerIdempotencyKey = `care_bubble:${input.idempotencyKey}`;

  await prisma.fishTankResourceLedger.upsert({
    where: { userId_idempotencyKey: { userId, idempotencyKey: ledgerIdempotencyKey } },
    create: {
      userId,
      resourceType: FishTankResourceType.bubble,
      quantity: -input.cost,
      sourceType: "care_bubble",
      sourceId: input.careEventId,
      idempotencyKey: ledgerIdempotencyKey,
      metadata: { careEventId: input.careEventId, cost: input.cost }
    },
    update: {}
  });

  const newBalance = previousBalance - input.cost;
  return { previousBalance, newBalance };
}

export class FishTankResourceError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "FishTankResourceError";
  }
}

export function buildExistingLoopAuditMetadata(input: {
  sourceType: ExistingRewardSourceType;
  sourceId: string;
  policyVersion: string;
  outcome: "granted" | "replayed" | "empty" | "rejected" | "rolled_back";
  outcomes?: FishTankResourceOutcome[];
  reason?: string;
}) {
  return {
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    policyVersion: input.policyVersion,
    outcome: input.outcome,
    resources: input.outcomes?.map((outcome) => ({
      resourceType: outcome.resourceType,
      quantity: outcome.quantity
    })),
    reason: input.reason ?? null
  };
}

export async function getResourceSummary(
  prisma: PrismaClientLike,
  userId: string
): Promise<FishTankResourceSummary> {
  const rows = await prisma.fishTankResourceLedger.groupBy({
    by: ["resourceType"],
    where: { userId },
    _sum: { quantity: true }
  });

  const totals: Record<FishTankResourceType, number> = {
    [FishTankResourceType.food]: 0,
    [FishTankResourceType.bubble]: 0,
    [FishTankResourceType.hatch_progress]: 0
  };

  for (const row of rows) {
    totals[row.resourceType] = row._sum.quantity ?? 0;
  }

  return {
    resources: [
      { resourceType: FishTankResourceType.food, quantity: totals[FishTankResourceType.food], label: resourceLabels[FishTankResourceType.food] },
      { resourceType: FishTankResourceType.bubble, quantity: totals[FishTankResourceType.bubble], label: resourceLabels[FishTankResourceType.bubble] },
      { resourceType: FishTankResourceType.hatch_progress, quantity: totals[FishTankResourceType.hatch_progress], label: resourceLabels[FishTankResourceType.hatch_progress] }
    ],
    totalFood: totals[FishTankResourceType.food],
    totalBubbles: totals[FishTankResourceType.bubble],
    totalHatchProgress: totals[FishTankResourceType.hatch_progress]
  };
}
