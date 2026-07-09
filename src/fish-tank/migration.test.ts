import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("fish tank resource migration", () => {
  it("uses the PostgreSQL enum name mapped by Prisma", () => {
    const sql = readFileSync(
      new URL(
        "../../prisma/migrations/20260708000000_add_fish_tank_resource_ledger/migration.sql",
        import.meta.url
      ),
      "utf8"
    );

    expect(sql).toContain('CREATE TYPE "fish_tank_resource_type"');
    expect(sql).toContain('"resource_type" "fish_tank_resource_type" NOT NULL');
    expect(sql).not.toContain('"FishTankResourceType"');
  });
});
