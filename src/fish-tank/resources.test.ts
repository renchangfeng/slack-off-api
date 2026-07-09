import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { FishTankResourceType, grantResourcesFromBeanDraw, getResourceSummary } from "./resources.js";

describe("fish tank resources", () => {
  function createMockPrisma(initial: Array<{ resourceType: FishTankResourceType; quantity: number }> = []) {
    const ledger: Array<{
      userId: string;
      resourceType: FishTankResourceType;
      quantity: number;
      idempotencyKey: string;
    }> = initial.map((entry, index) => ({
      userId: "user-1",
      resourceType: entry.resourceType,
      quantity: entry.quantity,
      idempotencyKey: `existing-${index}`
    }));

    const mock = {
      fishTankResourceLedger: {
        upsert: vi.fn(async ({ where, create }: { where: { userId_idempotencyKey: { userId: string; idempotencyKey: string } }; create: { userId: string; resourceType: FishTankResourceType; quantity: number; sourceType: string; sourceId: string | null; idempotencyKey: string; metadata: object } }) => {
          const existing = ledger.find(
            (entry) => entry.userId === where.userId_idempotencyKey.userId && entry.idempotencyKey === where.userId_idempotencyKey.idempotencyKey
          );
          if (existing) {
            return existing;
          }
          const created = { userId: create.userId, resourceType: create.resourceType, quantity: create.quantity, idempotencyKey: where.userId_idempotencyKey.idempotencyKey };
          ledger.push(created);
          return created;
        }),
        groupBy: vi.fn(async () => {
          const groups = new Map<FishTankResourceType, number>();
          for (const entry of ledger) {
            groups.set(entry.resourceType, (groups.get(entry.resourceType) ?? 0) + entry.quantity);
          }
          return Array.from(groups.entries()).map(([resourceType, quantity]) => ({
            resourceType,
            _sum: { quantity }
          }));
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
});
