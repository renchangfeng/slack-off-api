CREATE TYPE "BeanTheme" AS ENUM ('office', 'restroom', 'daydream');

ALTER TABLE "bean_definitions" ADD COLUMN "theme" "BeanTheme";
UPDATE "bean_definitions" SET "theme" = 'office';
ALTER TABLE "bean_definitions" ALTER COLUMN "theme" SET NOT NULL;

ALTER TABLE "user_stats" ADD COLUMN "bean_fragments" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "user_stats" ADD COLUMN "bean_pity_count" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "bean_showcase" (
    "user_id" UUID NOT NULL,
    "bean_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "bean_showcase_pkey" PRIMARY KEY ("user_id", "position")
);

CREATE UNIQUE INDEX "bean_showcase_user_id_bean_id_key" ON "bean_showcase"("user_id", "bean_id");

ALTER TABLE "bean_showcase"
ADD CONSTRAINT "bean_showcase_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "bean_showcase"
ADD CONSTRAINT "bean_showcase_bean_id_fkey"
FOREIGN KEY ("bean_id") REFERENCES "bean_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
