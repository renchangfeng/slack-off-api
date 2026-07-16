-- CreateTable
CREATE TABLE "fish_tank_display_order_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "displayed_fish_ids" UUID[] NOT NULL,
    "result_metadata" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fish_tank_display_order_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fish_tank_display_order_events_user_id_idempotency_key_key" ON "fish_tank_display_order_events"("user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "fish_tank_display_order_events_user_id_created_at_idx" ON "fish_tank_display_order_events"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "fish_tank_display_order_events" ADD CONSTRAINT "fish_tank_display_order_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
