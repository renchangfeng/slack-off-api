ALTER TYPE "RewardSourceType" ADD VALUE IF NOT EXISTS 'progression';

CREATE TYPE "ProgressionPeriodType" AS ENUM ('daily', 'weekly');

CREATE TABLE "progression_goal_periods" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "period_type" "ProgressionPeriodType" NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "claimed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "progression_goal_periods_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "progression_goal_periods_user_id_period_type_period_start_key"
ON "progression_goal_periods"("user_id", "period_type", "period_start");

CREATE INDEX "progression_goal_periods_user_id_period_type_idx"
ON "progression_goal_periods"("user_id", "period_type");

ALTER TABLE "progression_goal_periods"
ADD CONSTRAINT "progression_goal_periods_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
