-- One-time prod reconcile: rebuild drizzle.__drizzle_migrations to match the now-committed
-- drizzle/ folder (migrations 0000-0013), so `npm run db:migrate` becomes a clean no-op.
--
-- Run AFTER scripts/prod-hotfix-0009-0013.sql has brought the schema to the 0013 state, and
-- AFTER the commit that ships drizzle/ via git. Run once:
--   psql "$DATABASE_URL" -f scripts/prod-reconcile-migrations.sql
--
-- hash      = sha256(<the migration .sql file content>), hex  (drizzle-orm migrator.js)
-- created_at= journal `when` in ms  (drizzle/meta/_journal.json)
-- Apply gate in drizzle: a migration runs only if its `when` > MAX(created_at). After this
-- table holds 0013's timestamp as the max, migrate applies nothing further.
BEGIN;

TRUNCATE TABLE drizzle.__drizzle_migrations RESTART IDENTITY;

INSERT INTO drizzle.__drizzle_migrations ("hash", "created_at") VALUES
	('69b602505b855c5d062dbfab682fe16807840485ce7ac572fb0dec4c9fdcf94c', 1779525831374), -- 0000_flimsy_warpath
	('d231f73046b8471987639c679ae0224b68de6d92595ca67a918a713f4af591b9', 1780125784296), -- 0001_dizzy_talon
	('32e9fbf4e5079b7eb5661bd0ddec4a5c123fec9f218fd0364e04b8e92c4c5401', 1780511297801), -- 0002_curvy_sersi
	('1ad4b53c66c40c0b6730f3d883a75ad07ca58e2e64a2bfe3502c7eaf8562e8c0', 1780512099247), -- 0003_lovely_hercules
	('af0900e4aa9dd6523a71c0939b14215b492908ba220c1d78ffc964a618ed5a20', 1780513626669), -- 0004_talented_switch
	('f145fdba20cf76512087461c25929f24a9e1a7b2502a0717917bcde90c279671', 1781430531054), -- 0005_sticky_shard
	('1f79158a9b0c84466997e20dbe4f875f4f61ba4ef083331f1504538a3b0fddd7', 1781711611800), -- 0006_open_mentor
	('83b09cfe35e90035bc2a0e3fc0edd46070f5a8ccae141dcda10c953260fcd276', 1781713534046), -- 0007_ordinary_lady_mastermind
	('d977fd94d78d6ab87e42578d1ece2ea9af510fae9781015a95dc50446a798251', 1781722174938), -- 0008_curly_gravity
	('d85270d8f25b854b55f27fcdecc1709b3cb2045e4611d8cf54a96ef0177a4f3d', 1781946748159), -- 0009_certain_manta
	('c96e40652a8159d59c55b3df2831400e1ab897f15603ded35eaf2915db11a283', 1781978244283), -- 0010_futuristic_jigsaw
	('04b649f10040ed0a712fe523b4c1f3339bc96681ddd6fc14dfa95dd83799906e', 1782047865352), -- 0011_cloudy_justin_hammer
	('2f80e2627c5f68b0fc5272c536a65ea9fc58884edabc168af66a0755c78f6541', 1782067615816), -- 0012_panoramic_jack_flag
	('a7370e61f55e1332be2d6ae0d169f6b9635e19e9c54ede28a8cc898759c4ba5f', 1782068260158); -- 0013_classy_lethal_legion

COMMIT;
