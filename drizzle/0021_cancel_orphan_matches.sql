-- Матчи, оставшиеся открытыми в завершённых/отменённых турнирах, больше нельзя
-- сыграть; до исправления они блокировали игроков (правило «один матч за раз»).
UPDATE "prod"."matches" AS m
SET "status" = 'cancelled', "updated_at" = now()
FROM "prod"."tournaments" AS t
WHERE m."tournament_id" = t."id"
  AND t."status" IN ('completed', 'cancelled')
  AND m."status" NOT IN ('completed', 'cancelled');
