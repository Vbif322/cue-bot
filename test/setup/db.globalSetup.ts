import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import type { GlobalSetupContext } from 'vitest/node';

/**
 * Phase 0b — DB harness global setup (integration / e2e projects only).
 *
 * Spins up a throwaway Postgres container once per run and applies the schema
 * programmatically via drizzle's migrator.
 *
 * Why migrate() and not `drizzle-kit push`: push is interactive — it prints a
 * confirmation prompt that can't be auto-answered in a non-TTY child process
 * (`--force` only auto-approves data-loss, not table creation), so it silently
 * applies nothing. migrate() is deterministic and headless. The committed
 * migrations reference the `prod` schema but never CREATE it, so we create it
 * first. (Drift between migrations and src/db/schema should be guarded
 * separately, e.g. `drizzle-kit check` in CI.)
 *
 * The connection URI is handed to workers via `provide('dbUrl')`; each worker's
 * setupFile injects it into DATABASE_URL before importing db.ts.
 */
let container: StartedPostgreSqlContainer | undefined;

export default async function setup({ provide }: GlobalSetupContext) {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const url = container.getConnectionUri();

  const pool = new Pool({ connectionString: url });
  try {
    const migrationDb = drizzle(pool);
    await migrationDb.execute(sql`CREATE SCHEMA IF NOT EXISTS "prod"`);
    await migrate(migrationDb, { migrationsFolder: './drizzle' });
  } finally {
    await pool.end();
  }

  provide('dbUrl', url);

  return async () => {
    await container?.stop();
  };
}
