-- CreateIndex
CREATE INDEX "activity_assignments_user_id_status_assigned_at_idx" ON "activity_assignments"("user_id", "status", "assigned_at");
