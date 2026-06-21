import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/db.js';

import { createUser, createVenue } from '../helpers/factories.js';
import { truncateAll } from '../helpers/truncate.js';

/**
 * Phase 0b smoke test — proves the DB harness works end to end:
 * container is up, schema was pushed, services see the `prod` schema,
 * factories insert, and truncate resets state between tests.
 */
describe('phase 0b db harness', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('pushed the prod schema with the core tables', async () => {
    const result = await db.execute(
      sql`SELECT tablename FROM pg_tables WHERE schemaname = 'prod'`,
    );
    const names = (result.rows as { tablename: string }[]).map(
      (r) => r.tablename,
    );
    expect(names).toEqual(
      expect.arrayContaining(['users', 'tournaments', 'matches', 'venues']),
    );
  });

  it('inserts and reads back via factories', async () => {
    const venue = await createVenue();
    const user = await createUser();
    expect(venue.id).toBeTruthy();
    expect(user.username).toMatch(/^user_/);
  });

  it('truncateAll clears rows between tests', async () => {
    await createUser();
    await truncateAll();
    const result = await db.execute(
      sql`SELECT count(*)::int AS c FROM "prod"."users"`,
    );
    const firstRow = (result.rows as { c: number }[])[0];
    expect(firstRow).toBeDefined();
    if (!firstRow) return;
    expect(firstRow.c).toBe(0);
  });
});
