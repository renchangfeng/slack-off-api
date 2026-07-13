-- CreateEnum
CREATE TYPE "tank_decoration_slot" AS ENUM ('background', 'plant', 'prop', 'ambient');

-- CreateEnum
CREATE TYPE "tank_decoration_rarity" AS ENUM ('common', 'uncommon', 'rare', 'epic', 'legendary');

-- CreateTable
CREATE TABLE "tank_decoration_definitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "tank_decoration_slot" NOT NULL,
    "rarity" "tank_decoration_rarity" NOT NULL,
    "theme" TEXT,
    "art_key" TEXT NOT NULL,
    "unlock_hint" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tank_decoration_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_tank_decorations" (
    "user_id" UUID NOT NULL,
    "decoration_definition_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "acquired_source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_tank_decorations_pkey" PRIMARY KEY ("user_id", "decoration_definition_id")
);

-- CreateTable
CREATE TABLE "user_tank_equipped_decorations" (
    "user_id" UUID NOT NULL,
    "slot" "tank_decoration_slot" NOT NULL,
    "decoration_definition_id" UUID NOT NULL,
    "equipped_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_tank_equipped_decorations_pkey" PRIMARY KEY ("user_id", "slot")
);

-- CreateTable
CREATE TABLE "tank_decoration_equip_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "slot" "tank_decoration_slot" NOT NULL,
    "decoration_definition_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "outcome_code" TEXT NOT NULL,
    "replay" BOOLEAN NOT NULL DEFAULT false,
    "result_metadata" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tank_decoration_equip_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tank_decoration_definitions_code_key" ON "tank_decoration_definitions"("code");

-- CreateIndex
CREATE INDEX "tank_decoration_definitions_type_sort_order_idx" ON "tank_decoration_definitions"("type", "sort_order");

-- CreateIndex
CREATE INDEX "user_tank_decorations_user_id_idx" ON "user_tank_decorations"("user_id");

-- CreateIndex
CREATE INDEX "user_tank_equipped_decorations_user_id_idx" ON "user_tank_equipped_decorations"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tank_decoration_equip_events_user_id_idempotency_key_key" ON "tank_decoration_equip_events"("user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "tank_decoration_equip_events_user_id_created_at_idx" ON "tank_decoration_equip_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "tank_decoration_equip_events_decoration_definition_id_idx" ON "tank_decoration_equip_events"("decoration_definition_id");

-- AddForeignKey
ALTER TABLE "user_tank_decorations" ADD CONSTRAINT "user_tank_decorations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tank_decorations" ADD CONSTRAINT "user_tank_decorations_decoration_definition_id_fkey" FOREIGN KEY ("decoration_definition_id") REFERENCES "tank_decoration_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tank_equipped_decorations" ADD CONSTRAINT "user_tank_equipped_decorations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tank_equipped_decorations" ADD CONSTRAINT "user_tank_equipped_decorations_decoration_definition_id_fkey" FOREIGN KEY ("decoration_definition_id") REFERENCES "tank_decoration_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tank_decoration_equip_events" ADD CONSTRAINT "tank_decoration_equip_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tank_decoration_equip_events" ADD CONSTRAINT "tank_decoration_equip_events_decoration_definition_id_fkey" FOREIGN KEY ("decoration_definition_id") REFERENCES "tank_decoration_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
