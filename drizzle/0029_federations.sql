CREATE TABLE "prod"."federation_members" (
	"federation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "federation_members_federation_id_user_id_pk" PRIMARY KEY("federation_id","user_id"),
	CONSTRAINT "federation_members_role_check" CHECK ("prod"."federation_members"."role" IN ('owner', 'organizer'))
);
--> statement-breakpoint
CREATE TABLE "prod"."federations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"city" varchar(100) NOT NULL,
	"description" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prod"."tournaments" DROP CONSTRAINT "tournaments_visibility_check";--> statement-breakpoint
ALTER TABLE "prod"."group_chats" ADD COLUMN "federation_id" uuid;--> statement-breakpoint
ALTER TABLE "prod"."tournaments" ADD COLUMN "federation_id" uuid;--> statement-breakpoint
ALTER TABLE "prod"."users" ADD COLUMN "city" varchar(100);--> statement-breakpoint
ALTER TABLE "prod"."users" ADD COLUMN "created_by_federation_id" uuid;--> statement-breakpoint
ALTER TABLE "prod"."venues" ADD COLUMN "city" varchar(100);--> statement-breakpoint
ALTER TABLE "prod"."venues" ADD COLUMN "federation_id" uuid;--> statement-breakpoint
ALTER TABLE "prod"."federation_members" ADD CONSTRAINT "federation_members_federation_id_federations_id_fk" FOREIGN KEY ("federation_id") REFERENCES "prod"."federations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prod"."federation_members" ADD CONSTRAINT "federation_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "prod"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prod"."federations" ADD CONSTRAINT "federations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "prod"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "federation_members_user_idx" ON "prod"."federation_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "federations_city_idx" ON "prod"."federations" USING btree ("city");--> statement-breakpoint
ALTER TABLE "prod"."group_chats" ADD CONSTRAINT "group_chats_federation_id_federations_id_fk" FOREIGN KEY ("federation_id") REFERENCES "prod"."federations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prod"."tournaments" ADD CONSTRAINT "tournaments_federation_id_federations_id_fk" FOREIGN KEY ("federation_id") REFERENCES "prod"."federations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prod"."users" ADD CONSTRAINT "users_created_by_federation_id_federations_id_fk" FOREIGN KEY ("created_by_federation_id") REFERENCES "prod"."federations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prod"."venues" ADD CONSTRAINT "venues_federation_id_federations_id_fk" FOREIGN KEY ("federation_id") REFERENCES "prod"."federations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_chats_federation_idx" ON "prod"."group_chats" USING btree ("federation_id");--> statement-breakpoint
CREATE INDEX "tournaments_federation_idx" ON "prod"."tournaments" USING btree ("federation_id");--> statement-breakpoint
CREATE INDEX "venues_federation_idx" ON "prod"."venues" USING btree ("federation_id");--> statement-breakpoint
ALTER TABLE "prod"."tournaments" ADD CONSTRAINT "tournaments_visibility_check" CHECK ("prod"."tournaments"."visibility" IN ('public', 'unlisted', 'private'));