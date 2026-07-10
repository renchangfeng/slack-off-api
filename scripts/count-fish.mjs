import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const count = await prisma.fishDefinition.count();
console.log("fish count", count);
const fish = await prisma.fishDefinition.findMany({ orderBy: { sortOrder: "asc" } });
for (const f of fish) {
  console.log(f.code, f.name, f.active);
}
await prisma.$disconnect();
