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

describe("fish hatch migration", () => {
  it("uses PostgreSQL identifiers that match Prisma @@map names", () => {
    const sql = readFileSync(
      new URL(
        "../../prisma/migrations/20260709000000_add_fish_hatch_event/migration.sql",
        import.meta.url
      ),
      "utf8"
    );

    expect(sql).toContain('CREATE TABLE "fish_hatch_events"');
    expect(sql).toContain('"user_id" UUID NOT NULL');
    expect(sql).toContain('"fish_definition_id" UUID NOT NULL');
    expect(sql).toContain('"idempotency_key" TEXT NOT NULL');
    expect(sql).toContain('"hatch_cost" INTEGER NOT NULL');
    expect(sql).toContain('"outcome_code" TEXT NOT NULL');
    expect(sql).toContain('"duplicate" BOOLEAN NOT NULL DEFAULT false');
    expect(sql).toContain('"result_metadata" JSONB NOT NULL');
    expect(sql).toContain('"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP');
    expect(sql).toContain('"fish_hatch_events_pkey" PRIMARY KEY ("id")');
    expect(sql).toContain('"fish_hatch_events_user_id_idempotency_key_key"');
    expect(sql).toContain('"fish_hatch_events_user_id_created_at_idx"');
    expect(sql).toContain('"fish_hatch_events_fish_definition_id_idx"');
    expect(sql).toContain('"fish_hatch_events_user_id_fkey"');
    expect(sql).toContain('"fish_hatch_events_fish_definition_id_fkey"');
    expect(sql).not.toContain('"FishHatchEvent"');
  });
});

describe("fish tank decoration migration", () => {
  it("uses PostgreSQL identifiers that match Prisma @@map names", () => {
    const sql = readFileSync(
      new URL(
        "../../prisma/migrations/20260710000000_add_fish_tank_decorations/migration.sql",
        import.meta.url
      ),
      "utf8"
    );

    expect(sql).toContain('CREATE TYPE "tank_decoration_slot"');
    expect(sql).toContain('CREATE TYPE "tank_decoration_rarity"');
    expect(sql).toContain('CREATE TABLE "tank_decoration_definitions"');
    expect(sql).toContain('CREATE TABLE "user_tank_decorations"');
    expect(sql).toContain('CREATE TABLE "user_tank_equipped_decorations"');
    expect(sql).toContain('CREATE TABLE "tank_decoration_equip_events"');
    expect(sql).toContain('"type" "tank_decoration_slot" NOT NULL');
    expect(sql).toContain('"rarity" "tank_decoration_rarity" NOT NULL');
    expect(sql).toContain('"tank_decoration_definitions_code_key"');
    expect(sql).toContain('"tank_decoration_definitions_type_sort_order_idx"');
    expect(sql).toContain('"user_tank_decorations_user_id_idx"');
    expect(sql).toContain('"user_tank_equipped_decorations_user_id_idx"');
    expect(sql).toContain('"tank_decoration_equip_events_user_id_idempotency_key_key"');
    expect(sql).toContain('"tank_decoration_equip_events_user_id_created_at_idx"');
    expect(sql).toContain('"tank_decoration_equip_events_decoration_definition_id_idx"');
    expect(sql).toContain('"user_tank_decorations_user_id_fkey"');
    expect(sql).toContain('"user_tank_decorations_decoration_definition_id_fkey"');
    expect(sql).toContain('"user_tank_equipped_decorations_user_id_fkey"');
    expect(sql).toContain('"user_tank_equipped_decorations_decoration_definition_id_fkey"');
    expect(sql).toContain('"tank_decoration_equip_events_user_id_fkey"');
    expect(sql).toContain('"tank_decoration_equip_events_decoration_definition_id_fkey"');
    expect(sql).not.toContain('"TankDecorationDefinition"');
    expect(sql).not.toContain('"TankDecorationSlot"');
    expect(sql).not.toContain('"TankDecorationRarity"');
  });
});
