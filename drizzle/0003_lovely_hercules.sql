ALTER TABLE "prod"."tournaments" ADD COLUMN "invite_code" varchar(16);--> statement-breakpoint
ALTER TABLE "prod"."tournaments" ADD CONSTRAINT "tournaments_invite_code_unique" UNIQUE("invite_code");