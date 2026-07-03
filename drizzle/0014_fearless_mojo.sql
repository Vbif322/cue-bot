CREATE TABLE "prod"."user_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" varchar NOT NULL,
	"provider_id" varchar(255) NOT NULL,
	"password_hash" varchar(255),
	"email_verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_identities_provider_check" CHECK ("prod"."user_identities"."provider" IN ('telegram', 'email'))
);
--> statement-breakpoint
ALTER TABLE "prod"."user_identities" ADD CONSTRAINT "user_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "prod"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_identities_provider_provider_id_unique" ON "prod"."user_identities" USING btree ("provider","provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_identities_user_id_provider_unique" ON "prod"."user_identities" USING btree ("user_id","provider");--> statement-breakpoint
INSERT INTO "prod"."user_identities" (user_id, provider, provider_id)
SELECT id, 'telegram', telegram_id FROM "prod"."users"
WHERE telegram_id IS NOT NULL AND deleted_at IS NULL
ON CONFLICT (provider, provider_id) DO NOTHING;