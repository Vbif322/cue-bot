import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';

import { startMigratedPostgres } from './postgres.js';

declare module 'vitest' {
  interface ProvidedContext {
    dbUrl: string;
  }
}

/**
 * Phase 0b — DB harness global setup (integration project only).
 *
 * Spins up a throwaway, migrated Postgres container once per run (see
 * `startMigratedPostgres`). The connection URI is handed to workers via
 * `provide('dbUrl')`; each worker's setupFile injects it into DATABASE_URL
 * before importing db.ts.
 */
let container: StartedPostgreSqlContainer | undefined;

export default async function setup({ provide }: TestProject) {
  const started = await startMigratedPostgres();
  container = started.container;

  provide('dbUrl', started.url);

  return async () => {
    await container?.stop();
  };
}
