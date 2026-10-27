ALTER TABLE "prod"."users" ADD COLUMN "max_federations" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "prod"."users" ADD COLUMN "max_tournaments_per_month" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "prod"."users" ADD CONSTRAINT "users_max_federations_check" CHECK ("prod"."users"."max_federations" >= 0);--> statement-breakpoint
ALTER TABLE "prod"."users" ADD CONSTRAINT "users_max_tournaments_per_month_check" CHECK ("prod"."users"."max_tournaments_per_month" >= 0);