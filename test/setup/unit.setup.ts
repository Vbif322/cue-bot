/**
 * Unit project setup — runs before each unit test file is imported.
 *
 * `src/db/db.ts` throws at module load if DATABASE_URL is unset, and many
 * services (matchService, tournamentService, …) import `db` at the top level.
 * node-postgres creates its connection pool lazily, so a dummy URL lets these
 * modules import cleanly without ever opening a real connection. If a unit
 * test accidentally calls a function that issues a query, it will hang/timeout
 * — surfacing a mis-scoped test rather than silently hitting a DB.
 */
process.env.DATABASE_URL ??=
  'postgres://test:test@127.0.0.1:5432/cue_bot_unit';
process.env.JWT_SECRET ??= 'test-secret';
