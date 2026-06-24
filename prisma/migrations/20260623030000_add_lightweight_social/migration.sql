CREATE TYPE "SocialReactionType" AS ENUM ('tissue', 'like');

ALTER TABLE "users" ADD COLUMN "friend_code" TEXT;
CREATE UNIQUE INDEX "users_friend_code_key" ON "users"("friend_code");

CREATE TABLE "friendships" (
    "id" UUID NOT NULL,
    "user_a_id" UUID NOT NULL,
    "user_b_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "friendships_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "squads" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "invite_code" TEXT NOT NULL,
    "owner_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "squads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "squad_memberships" (
    "user_id" UUID NOT NULL,
    "squad_id" UUID NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "squad_memberships_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "invite_code" TEXT NOT NULL,
    "owner_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "company_memberships" (
    "user_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "anonymous_alias" TEXT NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "company_memberships_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE "social_reactions" (
    "id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "reaction_type" "SocialReactionType" NOT NULL,
    "reaction_date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "social_reactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "friendships_user_a_id_user_b_id_key" ON "friendships"("user_a_id", "user_b_id");
CREATE INDEX "friendships_user_a_id_idx" ON "friendships"("user_a_id");
CREATE INDEX "friendships_user_b_id_idx" ON "friendships"("user_b_id");
CREATE UNIQUE INDEX "squads_invite_code_key" ON "squads"("invite_code");
CREATE INDEX "squad_memberships_squad_id_idx" ON "squad_memberships"("squad_id");
CREATE UNIQUE INDEX "companies_invite_code_key" ON "companies"("invite_code");
CREATE UNIQUE INDEX "company_memberships_company_id_anonymous_alias_key" ON "company_memberships"("company_id", "anonymous_alias");
CREATE INDEX "company_memberships_company_id_idx" ON "company_memberships"("company_id");
CREATE UNIQUE INDEX "social_reactions_sender_id_recipient_id_reaction_type_reaction_date_key" ON "social_reactions"("sender_id", "recipient_id", "reaction_type", "reaction_date");
CREATE INDEX "social_reactions_sender_id_reaction_date_idx" ON "social_reactions"("sender_id", "reaction_date");
CREATE INDEX "social_reactions_recipient_id_reaction_date_idx" ON "social_reactions"("recipient_id", "reaction_date");

ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_a_id_fkey" FOREIGN KEY ("user_a_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_b_id_fkey" FOREIGN KEY ("user_b_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "squads" ADD CONSTRAINT "squads_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "squad_memberships" ADD CONSTRAINT "squad_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "squad_memberships" ADD CONSTRAINT "squad_memberships_squad_id_fkey" FOREIGN KEY ("squad_id") REFERENCES "squads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "companies" ADD CONSTRAINT "companies_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_reactions" ADD CONSTRAINT "social_reactions_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_reactions" ADD CONSTRAINT "social_reactions_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
