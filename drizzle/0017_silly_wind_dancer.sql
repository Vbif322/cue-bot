ALTER TABLE "prod"."tournaments" DROP CONSTRAINT "tournaments_discipline_check";--> statement-breakpoint
ALTER TABLE "prod"."tournaments" ADD COLUMN "sport" varchar;--> statement-breakpoint
-- Backfill the pre-two-level rows: every existing tournament was snooker; the
-- closest new discipline for the old flat 'snooker' is the full 15-red game.
UPDATE "prod"."tournaments" SET "sport" = 'snooker', "discipline" = 'snooker_15_red' WHERE "discipline" = 'snooker';--> statement-breakpoint
ALTER TABLE "prod"."tournaments" ALTER COLUMN "sport" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "prod"."tournaments" ADD CONSTRAINT "tournaments_sport_check" CHECK ("prod"."tournaments"."sport" IN ('snooker', 'pool', 'russian_billiards'));--> statement-breakpoint
ALTER TABLE "prod"."tournaments" ADD CONSTRAINT "tournaments_discipline_check" CHECK ("prod"."tournaments"."discipline" IN ('snooker_15_red', 'snooker_10_red', 'snooker_6_red', 'pool_8', 'pool_9', 'pool_10', 'russian_free', 'russian_combined', 'russian_dynamic'));
