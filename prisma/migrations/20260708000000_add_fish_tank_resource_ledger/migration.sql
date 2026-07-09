-- CreateEnum
CREATE TYPE "fish_tank_resource_type" AS ENUM ('food', 'bubble', 'hatch_progress');

-- CreateTable
CREATE TABLE "fish_tank_resource_ledger" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "resource_type" "fish_tank_resource_type" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID,
    "idempotency_key" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fish_tank_resource_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fish_tank_resource_ledger_user_id_idempotency_key_key" ON "fish_tank_resource_ledger"("user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "fish_tank_resource_ledger_user_id_resource_type_idx" ON "fish_tank_resource_ledger"("user_id", "resource_type");

-- CreateIndex
CREATE INDEX "fish_tank_resource_ledger_user_id_source_type_source_id_idx" ON "fish_tank_resource_ledger"("user_id", "source_type", "source_id");

-- AddForeignKey
ALTER TABLE "fish_tank_resource_ledger" ADD CONSTRAINT "fish_tank_resource_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
