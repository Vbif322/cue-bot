ALTER TABLE "prod"."login_codes" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "prod"."login_codes" CASCADE;--> statement-breakpoint
-- Backfill: dedupe usernames among Telegram accounts before the unique index.
-- Keep the row with the smallest UUID (deterministic, not chronological); give
-- the rest the stable placeholder so the partial unique index can be created.
UPDATE "prod"."users" u SET "username" = 'user_' || u."telegram_id"
WHERE u."telegram_id" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "prod"."users" u2
    WHERE u2."username" = u."username"
      AND u2."telegram_id" IS NOT NULL
      AND u2."id" < u."id"
  );--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_telegram_unique" ON "prod"."users" USING btree ("username") WHERE telegram_id is not null;