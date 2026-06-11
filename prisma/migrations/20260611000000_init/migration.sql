-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "CheckInStatus" AS ENUM ('active', 'completed', 'cancelled', 'invalidated');

-- CreateEnum
CREATE TYPE "LeaderboardWindow" AS ENUM ('daily', 'weekly', 'monthly', 'all_time');

-- CreateEnum
CREATE TYPE "BeanRarity" AS ENUM ('common', 'uncommon', 'rare', 'epic', 'legendary');

-- CreateEnum
CREATE TYPE "RewardSourceType" AS ENUM ('check_in', 'activity', 'achievement', 'bean_draw', 'admin');

-- CreateEnum
CREATE TYPE "RewardType" AS ENUM ('score', 'draw_progress', 'draw_chance', 'bean', 'cosmetic');

-- CreateEnum
CREATE TYPE "AchievementRuleType" AS ENUM ('first_checkin', 'streak', 'total_duration', 'activity_count', 'collection_count', 'weekly_top_rank');

-- CreateEnum
CREATE TYPE "CosmeticType" AS ENUM ('badge', 'title');

-- CreateEnum
CREATE TYPE "ActivityCategory" AS ENUM ('game', 'rest', 'office_theater', 'absurd', 'tiny_task');

-- CreateEnum
CREATE TYPE "ActivityDifficulty" AS ENUM ('easy', 'normal', 'hard');

-- CreateEnum
CREATE TYPE "ActivityAssignmentStatus" AS ENUM ('active', 'completed', 'skipped', 'expired');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "auth_subject" TEXT NOT NULL,
    "email" TEXT,
    "display_name" TEXT NOT NULL,
    "avatar_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "user_id" UUID NOT NULL,
    "bio" TEXT,
    "equipped_badge_id" UUID,
    "equipped_title_id" UUID,
    "privacy_mode" TEXT NOT NULL DEFAULT 'public_alias',
    "timezone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "check_in_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "duration_seconds" INTEGER,
    "eligible_duration_seconds" INTEGER,
    "status" "CheckInStatus" NOT NULL,
    "invalid_reason" TEXT,
    "rewarded" BOOLEAN NOT NULL DEFAULT false,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "check_in_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_stats" (
    "user_id" UUID NOT NULL,
    "total_sessions" INTEGER NOT NULL DEFAULT 0,
    "total_duration_seconds" INTEGER NOT NULL DEFAULT 0,
    "eligible_duration_seconds" INTEGER NOT NULL DEFAULT 0,
    "current_streak_days" INTEGER NOT NULL DEFAULT 0,
    "longest_streak_days" INTEGER NOT NULL DEFAULT 0,
    "last_eligible_checkin_date" DATE,
    "draw_chances" INTEGER NOT NULL DEFAULT 0,
    "draw_progress" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_stats_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "leaderboard_scores" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "window" "LeaderboardWindow" NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "rank_cache" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leaderboard_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bean_definitions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rarity" "BeanRarity" NOT NULL,
    "description" TEXT NOT NULL,
    "image_key" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "weight" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bean_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bean_inventory" (
    "user_id" UUID NOT NULL,
    "bean_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "first_obtained_at" TIMESTAMP(3) NOT NULL,
    "last_obtained_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bean_inventory_pkey" PRIMARY KEY ("user_id","bean_id")
);

-- CreateTable
CREATE TABLE "reward_ledger" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "source_type" "RewardSourceType" NOT NULL,
    "source_id" UUID,
    "reward_type" "RewardType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "metadata" JSONB NOT NULL,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achievements" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "rule_type" "AchievementRuleType" NOT NULL,
    "rule_config" JSONB NOT NULL,
    "reward_config" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_achievements" (
    "user_id" UUID NOT NULL,
    "achievement_id" UUID NOT NULL,
    "unlocked_at" TIMESTAMP(3) NOT NULL,
    "reward_claimed_at" TIMESTAMP(3),

    CONSTRAINT "user_achievements_pkey" PRIMARY KEY ("user_id","achievement_id")
);

-- CreateTable
CREATE TABLE "cosmetics" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "cosmetic_type" "CosmeticType" NOT NULL,
    "rarity" "BeanRarity" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "cosmetics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_cosmetics" (
    "user_id" UUID NOT NULL,
    "cosmetic_id" UUID NOT NULL,
    "unlocked_at" TIMESTAMP(3) NOT NULL,
    "source_type" "RewardSourceType" NOT NULL,

    CONSTRAINT "user_cosmetics_pkey" PRIMARY KEY ("user_id","cosmetic_id")
);

-- CreateTable
CREATE TABLE "activity_templates" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "ActivityCategory" NOT NULL,
    "difficulty" "ActivityDifficulty" NOT NULL,
    "reward_config" JSONB NOT NULL,
    "cooldown_seconds" INTEGER NOT NULL,
    "daily_reward_limit" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "activity_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_assignments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "status" "ActivityAssignmentStatus" NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "rewarded" BOOLEAN NOT NULL DEFAULT false,
    "idempotency_key" TEXT,

    CONSTRAINT "activity_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "actor_user_id" UUID,
    "target_user_id" UUID,
    "request_id" TEXT,
    "trace_id" TEXT,
    "span_id" TEXT,
    "source_type" TEXT,
    "source_id" UUID,
    "metadata" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_auth_subject_key" ON "users"("auth_subject");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "check_in_sessions_idempotency_key_key" ON "check_in_sessions"("idempotency_key");

-- CreateIndex
CREATE INDEX "check_in_sessions_user_id_idx" ON "check_in_sessions"("user_id");

-- CreateIndex
CREATE INDEX "check_in_sessions_user_id_status_idx" ON "check_in_sessions"("user_id", "status");

-- CreateIndex
CREATE INDEX "leaderboard_scores_window_window_start_score_idx" ON "leaderboard_scores"("window", "window_start", "score");

-- CreateIndex
CREATE UNIQUE INDEX "leaderboard_scores_user_id_window_window_start_key" ON "leaderboard_scores"("user_id", "window", "window_start");

-- CreateIndex
CREATE UNIQUE INDEX "bean_definitions_code_key" ON "bean_definitions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "reward_ledger_idempotency_key_key" ON "reward_ledger"("idempotency_key");

-- CreateIndex
CREATE INDEX "reward_ledger_user_id_source_type_idx" ON "reward_ledger"("user_id", "source_type");

-- CreateIndex
CREATE UNIQUE INDEX "achievements_code_key" ON "achievements"("code");

-- CreateIndex
CREATE UNIQUE INDEX "cosmetics_code_key" ON "cosmetics"("code");

-- CreateIndex
CREATE UNIQUE INDEX "activity_templates_code_key" ON "activity_templates"("code");

-- CreateIndex
CREATE UNIQUE INDEX "activity_assignments_idempotency_key_key" ON "activity_assignments"("idempotency_key");

-- CreateIndex
CREATE INDEX "activity_assignments_user_id_status_idx" ON "activity_assignments"("user_id", "status");

-- CreateIndex
CREATE INDEX "audit_events_trace_id_idx" ON "audit_events"("trace_id");

-- CreateIndex
CREATE INDEX "audit_events_event_type_created_at_idx" ON "audit_events"("event_type", "created_at");

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_equipped_badge_id_fkey" FOREIGN KEY ("equipped_badge_id") REFERENCES "cosmetics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_equipped_title_id_fkey" FOREIGN KEY ("equipped_title_id") REFERENCES "cosmetics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_in_sessions" ADD CONSTRAINT "check_in_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_stats" ADD CONSTRAINT "user_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaderboard_scores" ADD CONSTRAINT "leaderboard_scores_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bean_inventory" ADD CONSTRAINT "bean_inventory_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bean_inventory" ADD CONSTRAINT "bean_inventory_bean_id_fkey" FOREIGN KEY ("bean_id") REFERENCES "bean_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_ledger" ADD CONSTRAINT "reward_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_achievement_id_fkey" FOREIGN KEY ("achievement_id") REFERENCES "achievements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_cosmetics" ADD CONSTRAINT "user_cosmetics_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_cosmetics" ADD CONSTRAINT "user_cosmetics_cosmetic_id_fkey" FOREIGN KEY ("cosmetic_id") REFERENCES "cosmetics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_assignments" ADD CONSTRAINT "activity_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_assignments" ADD CONSTRAINT "activity_assignments_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "activity_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
