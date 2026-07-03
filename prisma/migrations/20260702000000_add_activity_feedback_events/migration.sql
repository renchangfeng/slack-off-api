-- CreateEnum
CREATE TYPE "ActivityFeedbackType" AS ENUM ('liked', 'neutral', 'dislike_similar', 'want_weirder', 'too_much_work', 'too_long', 'too_physical', 'shorter');

-- CreateEnum
CREATE TYPE "ActivityFeedbackSource" AS ENUM ('completion', 'skip');

-- CreateTable
CREATE TABLE "activity_feedback_events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "assignment_id" UUID,
    "template_id" UUID NOT NULL,
    "category" "ActivityCategory" NOT NULL,
    "feedback_type" "ActivityFeedbackType" NOT NULL,
    "feedback_source" "ActivityFeedbackSource" NOT NULL,
    "skip_reason" TEXT,
    "interaction_types" JSONB NOT NULL,
    "metadata" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_feedback_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "activity_feedback_events_user_id_assignment_id_feedback_type_feedback_source_key" ON "activity_feedback_events"("user_id", "assignment_id", "feedback_type", "feedback_source");

-- CreateIndex
CREATE INDEX "activity_feedback_events_user_id_created_at_idx" ON "activity_feedback_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "activity_feedback_events_user_id_template_id_created_at_idx" ON "activity_feedback_events"("user_id", "template_id", "created_at");

-- CreateIndex
CREATE INDEX "activity_feedback_events_user_id_category_created_at_idx" ON "activity_feedback_events"("user_id", "category", "created_at");

-- AddForeignKey
ALTER TABLE "activity_feedback_events" ADD CONSTRAINT "activity_feedback_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_feedback_events" ADD CONSTRAINT "activity_feedback_events_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "activity_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_feedback_events" ADD CONSTRAINT "activity_feedback_events_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "activity_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
