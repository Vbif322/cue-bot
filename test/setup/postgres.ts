import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';

/**
 * Throwaway Postgres for the integration and e2e harnesses.
 *
 * Starts a container and applies the schema programmatically via drizzle's
 * migrator. Why migrate() and not `drizzle-kit push`: push is interactive — it
 * prints a confirmation prompt that can't be auto-answered in a non-TTY child
 * process (`--force` only auto-approves data-loss, not table creation), so it
 * silently applies nothing. migrate() is deterministic and headless. The
 * committed migrations reference the `prod` schema but never CREATE it, so we
 * create it first. (Drift between migrations and src/db/schema should be
 * guarded separately, e.g. `drizzle-kit check` in CI.)
 */
export async function startMigratedPostgres(): Promise<{
  container: StartedPostgreSqlContainer;
  url: string;
}> {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const url = container.getConnectionUri();

  const pool = new Pool({ connectionString: url });
  try {
    const migrationDb = drizzle(pool);
    await migrationDb.execute(sql`CREATE SCHEMA IF NOT EXISTS "prod"`);
    await migrate(migrationDb, { migrationsFolder: './drizzle' });
  } finally {
    await pool.end();
  }

  return { container, url };
}
