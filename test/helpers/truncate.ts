import { sql } from 'drizzle-orm';

import { db } from '@/db/db.js';

/**
 * Wipe every table in the `prod` schema between tests. Discovers tables
 * dynamically so new schema files are covered automatically. RESTART IDENTITY
 * resets sequences; CASCADE handles FK chains.
 */
export async function truncateAll(): Promise<void> {
  const result = await db.execute(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'prod'`,
  );
  const tables = (result.rows as { tablename: string }[]).map(
    (r) => `"prod"."${r.tablename}"`,
  );
  if (tables.length === 0) return;
  await db.execute(
    sql.raw(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`),
  );
}
