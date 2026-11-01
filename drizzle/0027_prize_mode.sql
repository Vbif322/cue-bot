ALTER TABLE "prod"."tournaments" ADD COLUMN "prize_mode" varchar DEFAULT 'percent' NOT NULL;--> statement-breakpoint
ALTER TABLE "prod"."tournaments" ADD CONSTRAINT "tournaments_prize_mode_check" CHECK ("prod"."tournaments"."prize_mode" IN ('percent', 'fixed'));;--> statement-breakpoint
-- Prize places are now { place, value } (percent or rubles per prize_mode);
-- rows written by 0026 hold { place, percent }, which are all percent mode.
UPDATE "prod"."tournaments"
SET "prize_distribution" = (
  SELECT jsonb_agg(
    jsonb_build_object('place', e -> 'place', 'value', e -> 'percent')
    ORDER BY ord
  )
  FROM jsonb_array_elements("prize_distribution") WITH ORDINALITY AS t(e, ord)
)
WHERE "prize_distribution" IS NOT NULL
  AND "prize_distribution" -> 0 ? 'percent';
