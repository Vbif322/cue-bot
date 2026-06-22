ALTER TABLE "prod"."matches" ADD COLUMN "phase" varchar DEFAULT 'playoff' NOT NULL;--> statement-breakpoint
ALTER TABLE "prod"."matches" ADD COLUMN "group_index" integer;--> statement-breakpoint
ALTER TABLE "prod"."tournaments" ADD COLUMN "groups_count" integer;--> statement-breakpoint
ALTER TABLE "prod"."tournaments" ADD COLUMN "participants_per_group" integer;--> statement-breakpoint
ALTER TABLE "prod"."tournaments" ADD COLUMN "qualifiers_per_group" integer;--> statement-breakpoint
ALTER TABLE "prod"."tournaments" ADD COLUMN "group_draw" varchar;