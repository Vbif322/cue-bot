-- Случайные пары бывают только в сетках на выбывание. У круговых турниров и
-- «группы + плей-офф» флаг мог остаться true из формы админки.
UPDATE "prod"."tournaments"
SET "random_advancement" = false, "updated_at" = now()
WHERE "random_advancement" = true
  AND "format" NOT IN ('single_elimination', 'double_elimination');
