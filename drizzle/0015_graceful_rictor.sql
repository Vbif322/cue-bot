CREATE TABLE "prod"."email_login_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "email_login_codes_email_idx" ON "prod"."email_login_codes" USING btree ("email");--> statement-breakpoint
ALTER TABLE "prod"."user_identities" DROP COLUMN "password_hash";