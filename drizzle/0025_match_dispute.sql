ALTER TABLE "prod"."matches" ADD COLUMN "disputed_at" timestamp;--> statement-breakpoint
ALTER TABLE "prod"."matches" ADD COLUMN "disputed_by" uuid;--> statement-breakpoint
ALTER TABLE "prod"."matches" ADD COLUMN "disputed_score" varchar(255);--> statement-breakpoint
ALTER TABLE "prod"."matches" ADD CONSTRAINT "matches_disputed_by_users_id_fk" FOREIGN KEY ("disputed_by") REFERENCES "prod"."users"("id") ON DELETE no action ON UPDATE no action;