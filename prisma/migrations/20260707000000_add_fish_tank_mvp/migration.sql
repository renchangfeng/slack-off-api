-- CreateEnum
CREATE TYPE "FishRarity" AS ENUM ('common', 'uncommon', 'rare', 'epic', 'legendary');

-- CreateEnum
CREATE TYPE "FishTheme" AS ENUM ('office', 'restroom', 'daydream');

-- CreateTable
CREATE TABLE "fish_definitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rarity" "FishRarity" NOT NULL,
    "theme" "FishTheme" NOT NULL,
    "personality" TEXT NOT NULL,
    "art_key" TEXT NOT NULL,
    "source_hint" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fish_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_tanks" (
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_tanks_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "user_fish" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "fish_definition_id" UUID NOT NULL,
    "acquired_source" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_fish_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fish_care_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "interaction_type" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "result_metadata" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fish_care_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fish_definitions_code_key" ON "fish_definitions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "user_fish_user_id_fish_definition_id_key" ON "user_fish"("user_id", "fish_definition_id");

-- CreateIndex
CREATE INDEX "user_fish_user_id_idx" ON "user_fish"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "fish_care_events_user_id_idempotency_key_key" ON "fish_care_events"("user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "fish_care_events_user_id_interaction_type_created_at_idx" ON "fish_care_events"("user_id", "interaction_type", "created_at");

-- AddForeignKey
ALTER TABLE "user_tanks" ADD CONSTRAINT "user_tanks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_fish" ADD CONSTRAINT "user_fish_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_fish" ADD CONSTRAINT "user_fish_user_id_tank_fkey" FOREIGN KEY ("user_id") REFERENCES "user_tanks"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_fish" ADD CONSTRAINT "user_fish_fish_definition_id_fkey" FOREIGN KEY ("fish_definition_id") REFERENCES "fish_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fish_care_events" ADD CONSTRAINT "fish_care_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
