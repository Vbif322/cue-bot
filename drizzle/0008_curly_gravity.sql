ALTER TABLE "prod"."tournaments" ADD COLUMN "random_advancement" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Migrate the retired 'double_elimination_random' format into the orthogonal
-- random_advancement flag on top of plain 'double_elimination'. Order matters:
-- set the flag before rewriting the format value.
UPDATE "prod"."tournaments" SET "random_advancement" = true WHERE "format" = 'double_elimination_random';
--> statement-breakpoint
UPDATE "prod"."tournaments" SET "format" = 'double_elimination' WHERE "format" = 'double_elimination_random';