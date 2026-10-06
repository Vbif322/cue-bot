ALTER TABLE "prod"."tournaments" ADD COLUMN "entry_fee" integer;--> statement-breakpoint
ALTER TABLE "prod"."tournaments" ADD COLUMN "organizer_fee_percent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "prod"."tournaments" ADD COLUMN "prize_distribution" jsonb;--> statement-breakpoint
ALTER TABLE "prod"."tournaments" ADD CONSTRAINT "tournaments_entry_fee_nonneg" CHECK ("prod"."tournaments"."entry_fee" >= 0);--> statement-breakpoint
ALTER TABLE "prod"."tournaments" ADD CONSTRAINT "tournaments_organizer_fee_percent_range" CHECK ("prod"."tournaments"."organizer_fee_percent" BETWEEN 0 AND 100);