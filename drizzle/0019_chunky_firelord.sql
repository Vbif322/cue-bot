ALTER TABLE "prod"."matches" ADD COLUMN "win_score" integer;--> statement-breakpoint
ALTER TABLE "prod"."tournaments" ADD COLUMN "stage_win_scores" jsonb;--> statement-breakpoint
ALTER TABLE "prod"."matches" ADD CONSTRAINT "matches_win_score_nonneg" CHECK ("prod"."matches"."win_score" >= 0);