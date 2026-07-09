import { FishTankResourceType, type Prisma } from "@prisma/client";

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
