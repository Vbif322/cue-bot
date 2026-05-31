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
