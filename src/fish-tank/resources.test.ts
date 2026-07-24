import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import {
  FishTankResourceType,
  FishTankResourceError,
  debitHatchProgress,
  debitFood,
  debitBubble,
  getHatchProgressBalance,
  grantResourcesFromBeanDraw,
  getResourceSummary,
  resolveExistingLoopOutcomes,
  grantExistingLoopRewards,
  reconstructExistingLoopOutcomes
} from "./resources.js";

describe("fish tank resources", () => {
  type LedgerRow = {
  userId: string;
  resourceType: FishTankResourceType;
  quantity: number;
  sourceType: string;
  sourceId: string | null;
  idempotencyKey: string;
  metadata: object;
  createdAt: Date;
};

  function createMockPrisma(initial: Array<{ resourceType: FishTankResourceType; quantity: number }> = []) {
    const ledger: LedgerRow[] = initial.map((entry, index) => ({
      userId: "user-1",
      resourceType: entry.resourceType,
      quantity: entry.quantity,
      sourceType: "seed",
      sourceId: null,
      idempotencyKey: `existing-${index}`,
      metadata: {},
      createdAt: new Date(Date.now() + index)
    }));

    const mock = {
      fishTankResourceLedger: {
        upsert: vi.fn(async ({ where, create }: { where: { userId_idempotencyKey: { userId: string; idempotencyKey: string } }; create: LedgerRow }) => {
          const existing = ledger.find(
            (entry) => entry.userId === where.userId_idempotencyKey.userId && entry.idempotencyKey === where.userId_idempotencyKey.idempotencyKey
          );
          if (existing) {
            return existing;
          }
          const created: LedgerRow = {
            ...create,
            sourceId: create.sourceId ?? null,
            metadata: create.metadata ?? {},
            createdAt: new Date()
          };
          ledger.push(created);
          return created;
        }),
        findMany: vi.fn(async ({ where }: { where: { userId?: string; sourceType?: string; sourceId?: string | null; quantity?: { gt?: number } }; orderBy?: { createdAt: "asc" | "desc" } }) => {
          let rows = ledger.filter((entry) => {
            if (where.userId !== undefined && entry.userId !== where.userId) return false;
            if (where.sourceType !== undefined && entry.sourceType !== where.sourceType) return false;
            if (where.sourceId !== undefined && entry.sourceId !== where.sourceId) return false;
            if (where.quantity?.gt !== undefined && !(entry.quantity > where.quantity.gt)) return false;
            return true;
          });
          rows = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
          return rows;
        }),
        groupBy: vi.fn(async ({ where }: { where?: { userId?: string }; by: string[] }) => {
          const groups = new Map<FishTankResourceType, number>();
          for (const entry of ledger) {
            if (where?.userId !== undefined && entry.userId !== where.userId) continue;
            groups.set(entry.resourceType, (groups.get(entry.resourceType) ?? 0) + entry.quantity);
          }
          return Array.from(groups.entries()).map(([resourceType, quantity]) => ({
            resourceType,
            _sum: { quantity }
          }));
        }),
        aggregate: vi.fn(async ({ where }: { where: { userId: string; resourceType: FishTankResourceType }; _sum: { quantity: boolean } }) => {
          const total = ledger
            .filter((entry) => entry.userId === where.userId && entry.resourceType === where.resourceType)
            .reduce((sum, entry) => sum + entry.quantity, 0);
          return { _sum: { quantity: total } };
        })
      }
    };

    return mock as unknown as Pick<Prisma.TransactionClient, "fishTankResourceLedger">;
  }

  it("grants bubble + hatch progress for new beans", async () => {
    const prisma = createMockPrisma();
    const outcomes = await grantResourcesFromBeanDraw(prisma, "user-1", {
      drawIdempotencyKey: "draw-1",
      rarity: "common",
      duplicate: false,
      pityTriggered: false
    });

    expect(outcomes.map((o) => ({ type: o.resourceType, quantity: o.quantity }))).toEqual([
      { type: FishTankResourceType.bubble, quantity: 1 },
      { type: FishTankResourceType.hatch_progress, quantity: 1 }
    ]);
    expect(prisma.fishTankResourceLedger.upsert).toHaveBeenCalledTimes(2);
  });

  it("grants bubble + food for duplicate common beans", async () => {
    const prisma = createMockPrisma();
    const outcomes = await grantResourcesFromBeanDraw(prisma, "user-1", {
      drawIdempotencyKey: "draw-2",
      rarity: "common",
      duplicate: true,
      pityTriggered: false
    });

    expect(outcomes.map((o) => ({ type: o.resourceType, quantity: o.quantity }))).toEqual([
      { type: FishTankResourceType.bubble, quantity: 1 },
      { type: FishTankResourceType.food, quantity: 1 }
    ]);
  });

  it("grants bubble + extra food for duplicate rare+ or pity beans", async () => {
    const prisma = createMockPrisma();
    const outcomes = await grantResourcesFromBeanDraw(prisma, "user-1", {
      drawIdempotencyKey: "draw-3",
      rarity: "rare",
      duplicate: true,
      pityTriggered: false
    });

    expect(outcomes.map((o) => ({ type: o.resourceType, quantity: o.quantity }))).toEqual([
      { type: FishTankResourceType.bubble, quantity: 1 },
      { type: FishTankResourceType.food, quantity: 2 }
    ]);
    expect(outcomes[1]?.copy).toContain("+2");
  });

  it("keeps hatch progress and adds extra food for new pity beans", async () => {
    const prisma = createMockPrisma();
    const outcomes = await grantResourcesFromBeanDraw(prisma, "user-1", {
      drawIdempotencyKey: "draw-pity-new",
      rarity: "rare",
      duplicate: false,
      pityTriggered: true
    });

    expect(outcomes.map((o) => ({ type: o.resourceType, quantity: o.quantity }))).toEqual([
      { type: FishTankResourceType.bubble, quantity: 1 },
      { type: FishTankResourceType.hatch_progress, quantity: 1 },
      { type: FishTankResourceType.food, quantity: 2 }
    ]);
    expect(outcomes[2]?.copy).toContain("+2");
  });

  it("is idempotent for the same draw idempotency key", async () => {
    const prisma = createMockPrisma();
    const input = {
      drawIdempotencyKey: "draw-4",
      rarity: "common",
      duplicate: false,
      pityTriggered: false
    };

    await grantResourcesFromBeanDraw(prisma, "user-1", input);
    await grantResourcesFromBeanDraw(prisma, "user-1", input);

    const summary = await getResourceSummary(prisma, "user-1");
    expect(summary.totalBubbles).toBe(1);
    expect(summary.totalHatchProgress).toBe(1);
    expect(summary.totalFood).toBe(0);
  });

  it("keeps different draws separate", async () => {
    const prisma = createMockPrisma();
    await grantResourcesFromBeanDraw(prisma, "user-1", {
      drawIdempotencyKey: "draw-a",
      rarity: "common",
      duplicate: false,
      pityTriggered: false
    });
    await grantResourcesFromBeanDraw(prisma, "user-1", {
      drawIdempotencyKey: "draw-b",
      rarity: "common",
      duplicate: false,
      pityTriggered: false
    });

    const summary = await getResourceSummary(prisma, "user-1");
    expect(summary.totalBubbles).toBe(2);
    expect(summary.totalHatchProgress).toBe(2);
  });

  it("returns zero summary when no resources exist", async () => {
    const prisma = createMockPrisma();
    const summary = await getResourceSummary(prisma, "user-1");
    expect(summary.totalFood).toBe(0);
    expect(summary.totalBubbles).toBe(0);
    expect(summary.totalHatchProgress).toBe(0);
    expect(summary.resources.every((r) => r.quantity === 0)).toBe(true);
  });

  describe("hatch progress debit", () => {
    it("debits hatch progress and returns new balance", async () => {
      const prisma = createMockPrisma([
        { resourceType: FishTankResourceType.hatch_progress, quantity: 5 }
      ]);

      const result = await debitHatchProgress(prisma, "user-1", {
        cost: 3,
        hatchEventId: "hatch-1",
        idempotencyKey: "debit-key-1"
      });

      expect(result.previousBalance).toBe(5);
      expect(result.newBalance).toBe(2);
      const summary = await getResourceSummary(prisma, "user-1");
      expect(summary.totalHatchProgress).toBe(2);
    });

    it("rejects debit when balance is insufficient", async () => {
      const prisma = createMockPrisma([
        { resourceType: FishTankResourceType.hatch_progress, quantity: 2 }
      ]);

      await expect(
        debitHatchProgress(prisma, "user-1", {
          cost: 3,
          hatchEventId: "hatch-1",
          idempotencyKey: "debit-key-1"
        })
      ).rejects.toBeInstanceOf(FishTankResourceError);

      const summary = await getResourceSummary(prisma, "user-1");
      expect(summary.totalHatchProgress).toBe(2);
    });

    it("does not double-debit on replay", async () => {
      const prisma = createMockPrisma([
        { resourceType: FishTankResourceType.hatch_progress, quantity: 6 }
      ]);

      await debitHatchProgress(prisma, "user-1", {
        cost: 3,
        hatchEventId: "hatch-1",
        idempotencyKey: "debit-key-1"
      });
      await debitHatchProgress(prisma, "user-1", {
        cost: 3,
        hatchEventId: "hatch-1",
        idempotencyKey: "debit-key-1"
      });

      const summary = await getResourceSummary(prisma, "user-1");
      expect(summary.totalHatchProgress).toBe(3);
    });

    it("isolates balances between users", async () => {
      const prisma = createMockPrisma([
        { resourceType: FishTankResourceType.hatch_progress, quantity: 5 }
      ]);

      await expect(
        debitHatchProgress(prisma, "user-2", {
          cost: 1,
          hatchEventId: "hatch-1",
          idempotencyKey: "debit-key-1"
        })
      ).rejects.toBeInstanceOf(FishTankResourceError);

      const user1Balance = await getHatchProgressBalance(prisma, "user-1");
      expect(user1Balance).toBe(5);
    });
  });

  describe("food debit", () => {
    it("debits food and returns new balance", async () => {
      const prisma = createMockPrisma([
        { resourceType: FishTankResourceType.food, quantity: 5 }
      ]);

      const result = await debitFood(prisma, "user-1", {
        cost: 1,
        careEventId: "care-1",
        idempotencyKey: "feed-key-1"
      });

      expect(result.previousBalance).toBe(5);
      expect(result.newBalance).toBe(4);
      const summary = await getResourceSummary(prisma, "user-1");
      expect(summary.totalFood).toBe(4);
    });

    it("rejects debit when food is insufficient", async () => {
      const prisma = createMockPrisma([
        { resourceType: FishTankResourceType.food, quantity: 0 }
      ]);

      await expect(
        debitFood(prisma, "user-1", {
          cost: 1,
          careEventId: "care-1",
          idempotencyKey: "feed-key-1"
        })
      ).rejects.toBeInstanceOf(FishTankResourceError);

      const summary = await getResourceSummary(prisma, "user-1");
      expect(summary.totalFood).toBe(0);
    });

    it("does not double-debit on replay", async () => {
      const prisma = createMockPrisma([
        { resourceType: FishTankResourceType.food, quantity: 5 }
      ]);

      await debitFood(prisma, "user-1", {
        cost: 1,
        careEventId: "care-1",
        idempotencyKey: "feed-key-1"
      });
      await debitFood(prisma, "user-1", {
        cost: 1,
        careEventId: "care-1",
        idempotencyKey: "feed-key-1"
      });

      const summary = await getResourceSummary(prisma, "user-1");
      expect(summary.totalFood).toBe(4);
    });
  });

  describe("bubble debit", () => {
    it("debits bubble and returns new balance", async () => {
      const prisma = createMockPrisma([
        { resourceType: FishTankResourceType.bubble, quantity: 5 }
      ]);

      const result = await debitBubble(prisma, "user-1", {
        cost: 1,
        careEventId: "care-1",
        idempotencyKey: "bubble-key-1"
      });

      expect(result.previousBalance).toBe(5);
      expect(result.newBalance).toBe(4);
      const summary = await getResourceSummary(prisma, "user-1");
      expect(summary.totalBubbles).toBe(4);
    });

    it("rejects debit when bubble is insufficient", async () => {
      const prisma = createMockPrisma([
        { resourceType: FishTankResourceType.bubble, quantity: 0 }
      ]);

      await expect(
        debitBubble(prisma, "user-1", {
          cost: 1,
          careEventId: "care-1",
          idempotencyKey: "bubble-key-1"
        })
      ).rejects.toBeInstanceOf(FishTankResourceError);

      const summary = await getResourceSummary(prisma, "user-1");
      expect(summary.totalBubbles).toBe(0);
    });

    it("does not double-debit on replay", async () => {
      const prisma = createMockPrisma([
        { resourceType: FishTankResourceType.bubble, quantity: 5 }
      ]);

      await debitBubble(prisma, "user-1", {
        cost: 1,
        careEventId: "care-1",
        idempotencyKey: "bubble-key-1"
      });
      await debitBubble(prisma, "user-1", {
        cost: 1,
        careEventId: "care-1",
        idempotencyKey: "bubble-key-1"
      });

      const summary = await getResourceSummary(prisma, "user-1");
      expect(summary.totalBubbles).toBe(4);
    });
  });

  describe("existing loop policy resolver", () => {
    it("resolves default check-in outcome", () => {
      const config = defaultExistingLoopConfig();
      const outcomes = resolveExistingLoopOutcomes("check_in_finish", config);
      expect(outcomes).toEqual([
        {
          resourceType: FishTankResourceType.food,
          quantity: 1,
          label: "鱼食",
          copy: "打卡完成，鱼食 +1。"
        }
      ]);
    });

    it("resolves default weekly goal outcome", () => {
      const config = defaultExistingLoopConfig();
      const outcomes = resolveExistingLoopOutcomes("weekly_goal_claim", config);
      expect(outcomes).toEqual([
        {
          resourceType: FishTankResourceType.hatch_progress,
          quantity: 2,
          label: "孵化进度",
          copy: "每周目标完成，孵化进度 +2。"
        }
      ]);
    });

    it("returns empty outcomes for disabled source", () => {
      const config = defaultExistingLoopConfig();
      config.sources.activityCompletion = [];
      const outcomes = resolveExistingLoopOutcomes("activity_completion", config);
      expect(outcomes).toEqual([]);
    });
  });

  describe("existing loop grant helper", () => {
    it("grants multi-type outcomes in one call", async () => {
      const prisma = createMockPrisma();
      const outcomes = await grantExistingLoopRewards(prisma, "user-1", {
        sourceType: "weekly_goal_claim",
        sourceId: "period-1",
        policyVersion: "v1",
        outcomes: [
          { resourceType: FishTankResourceType.hatch_progress, quantity: 2, label: "孵化进度", copy: "每周目标完成，孵化进度 +2。" }
        ],
        requestId: "req-1",
        traceId: "trace-1"
      });

      expect(outcomes).toHaveLength(1);
      expect(outcomes[0]?.quantity).toBe(2);
      expect(prisma.fishTankResourceLedger.upsert).toHaveBeenCalledTimes(1);
    });

    it("is idempotent for same source, resource, and policy version", async () => {
      const prisma = createMockPrisma();
      const input = {
        sourceType: "check_in_finish" as const,
        sourceId: "session-1",
        policyVersion: "v1",
        outcomes: [
          { resourceType: FishTankResourceType.food, quantity: 1, label: "鱼食", copy: "打卡完成，鱼食 +1。" }
        ]
      };

      await grantExistingLoopRewards(prisma, "user-1", input);
      await grantExistingLoopRewards(prisma, "user-1", input);

      const summary = await getResourceSummary(prisma, "user-1");
      expect(summary.totalFood).toBe(1);
    });

    it("isolates grants between users", async () => {
      const prisma = createMockPrisma();
      await grantExistingLoopRewards(prisma, "user-1", {
        sourceType: "check_in_finish",
        sourceId: "session-1",
        policyVersion: "v1",
        outcomes: [
          { resourceType: FishTankResourceType.food, quantity: 1, label: "鱼食", copy: "打卡完成，鱼食 +1。" }
        ]
      });
      await grantExistingLoopRewards(prisma, "user-2", {
        sourceType: "check_in_finish",
        sourceId: "session-2",
        policyVersion: "v1",
        outcomes: [
          { resourceType: FishTankResourceType.food, quantity: 1, label: "鱼食", copy: "打卡完成，鱼食 +1。" }
        ]
      });

      const user1Summary = await getResourceSummary(prisma, "user-1");
      expect(user1Summary.totalFood).toBe(1);
    });

    it("returns empty array when outcomes are empty", async () => {
      const prisma = createMockPrisma();
      const outcomes = await grantExistingLoopRewards(prisma, "user-1", {
        sourceType: "activity_completion",
        sourceId: "assignment-1",
        policyVersion: "v1",
        outcomes: []
      });
      expect(outcomes).toEqual([]);
      expect(prisma.fishTankResourceLedger.upsert).not.toHaveBeenCalled();
    });
  });

  describe("existing loop replay reconstruction", () => {
    it("reconstructs original outcomes from persisted rows", async () => {
      const prisma = createMockPrisma();
      const original = [
        { resourceType: FishTankResourceType.bubble, quantity: 1, label: "气泡", copy: "活动完成，气泡 +1。" }
      ];
      await grantExistingLoopRewards(prisma, "user-1", {
        sourceType: "activity_completion",
        sourceId: "assignment-1",
        policyVersion: "v1",
        outcomes: original
      });

      const replayed = await reconstructExistingLoopOutcomes(prisma, "user-1", {
        sourceType: "activity_completion",
        sourceId: "assignment-1"
      });

      expect(replayed).toEqual(original);
    });

    it("returns empty outcomes for historical source without ledger rows", async () => {
      const prisma = createMockPrisma();
      const outcomes = await reconstructExistingLoopOutcomes(prisma, "user-1", {
        sourceType: "check_in_finish",
        sourceId: "old-session"
      });
      expect(outcomes).toEqual([]);
    });

    it("reconstructs outcomes across policy versions", async () => {
      const prisma = createMockPrisma();
      await grantExistingLoopRewards(prisma, "user-1", {
        sourceType: "daily_goal_claim",
        sourceId: "period-1",
        policyVersion: "v1",
        outcomes: [
          { resourceType: FishTankResourceType.hatch_progress, quantity: 1, label: "孵化进度", copy: "每日目标完成，孵化进度 +1。" }
        ]
      });

      // A retry under a new policy version would still find the original v1 row.
      const replayed = await reconstructExistingLoopOutcomes(prisma, "user-1", {
        sourceType: "daily_goal_claim",
        sourceId: "period-1"
      });

      expect(replayed[0]?.quantity).toBe(1);
      expect(replayed[0]?.copy).toContain("每日目标完成");
    });
  });
});

function defaultExistingLoopConfig() {
  return {
    policyVersion: "v1",
    sources: {
      checkInFinish: [{ resourceType: "food" as const, quantity: 1 }],
      activityCompletion: [{ resourceType: "bubble" as const, quantity: 1 }],
      dailyGoalClaim: [{ resourceType: "hatch_progress" as const, quantity: 1 }],
      weeklyGoalClaim: [{ resourceType: "hatch_progress" as const, quantity: 2 }]
    }
  };
}
