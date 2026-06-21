import { inject } from 'vitest';

/**
 * Integration/e2e worker setup — runs before any test module is imported.
 *
 * `src/db/db.ts` reads DATABASE_URL once at module load to build its singleton
 * pool, so the container URI (provided by db.globalSetup) MUST be injected here,
 * before a test imports any service that transitively imports db.ts.
 */
process.env.DATABASE_URL = inject('dbUrl');
process.env.JWT_SECRET ??= 'test-secret';
// `src/bot/instance.ts` throws at import if BOT_TOKEN is unset, and the admin
// server (under test) imports the bot singleton transitively. A dummy token is
// enough: grammY's Bot constructor makes no network call until `bot.api.*` is
// invoked, which the admin tests either avoid or stub via vi.spyOn.
process.env.BOT_TOKEN ??= 'test-token';
