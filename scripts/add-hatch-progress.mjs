import { PrismaClient, FishTankResourceType } from "@prisma/client";

const prisma = new PrismaClient();
const userId = process.env.DEV_AUTH_SUBJECT ?? "11111111-1111-4111-8111-111111111111";
const quantity = Number(process.env.HATCH_PROGRESS ?? 3);

await prisma.fishTankResourceLedger.create({
  data: {
    userId,
    resourceType: FishTankResourceType.hatch_progress,
    quantity,
    sourceType: "smoke_test",
    sourceId: null,
    idempotencyKey: `smoke-grant-${Date.now()}`,
    metadata: { note: "manual smoke test grant" }
  }
});

const summary = await prisma.fishTankResourceLedger.groupBy({
  by: ["resourceType"],
  where: { userId },
  _sum: { quantity: true }
});

console.log("resource summary", JSON.stringify(summary, null, 2));
await prisma.$disconnect();
