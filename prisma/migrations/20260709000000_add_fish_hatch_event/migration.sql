-- CreateTable
CREATE TABLE "fish_hatch_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "fish_definition_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "hatch_cost" INTEGER NOT NULL,
    "outcome_code" TEXT NOT NULL,
    "duplicate" BOOLEAN NOT NULL DEFAULT false,
    "result_metadata" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fish_hatch_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fish_hatch_events_user_id_idempotency_key_key" ON "fish_hatch_events"("user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "fish_hatch_events_user_id_created_at_idx" ON "fish_hatch_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "fish_hatch_events_fish_definition_id_idx" ON "fish_hatch_events"("fish_definition_id");

-- AddForeignKey
ALTER TABLE "fish_hatch_events" ADD CONSTRAINT "fish_hatch_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fish_hatch_events" ADD CONSTRAINT "fish_hatch_events_fish_definition_id_fkey" FOREIGN KEY ("fish_definition_id") REFERENCES "fish_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
