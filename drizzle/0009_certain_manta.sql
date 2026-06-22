ALTER TABLE "prod"."matches" ADD COLUMN "losers_next_match_slot" varchar(10);--> statement-breakpoint
ALTER TABLE "prod"."tournaments" ADD COLUMN "merge_round" integer DEFAULT 2 NOT NULL;