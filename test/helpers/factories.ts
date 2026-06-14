import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import { loginTokens, tournaments, users, venues } from '@/db/schema.js';

/**
 * Test-data factories. Phase 0b ships the two leaf entities needed to validate
 * the harness; tournament/match/participant factories are added in Phase 2.
 */
let seq = 0;
const uniq = (): string => `${Date.now().toString(36)}_${String(seq++)}`;

export async function createUser(
  overrides: Partial<typeof users.$inferInsert> = {},
) {
  const [row] = await db
    .insert(users)
    .values({ username: `user_${uniq()}`, ...overrides })
    .returning();
  if (!row) throw new Error('insert returned no rows');
  return row;
}

/** A user with `role: 'admin'` — convenience wrapper used by admin-API tests. */
export async function createAdminUser(
  overrides: Partial<typeof users.$inferInsert> = {},
) {
  return createUser({ role: 'admin', ...overrides });
}

/**
 * Insert a one-click login token (`loginTokens` table). Defaults to a token
 * that expires one hour from now; pass `expiresAt` in the past to test expiry.
 */
export async function createLoginToken(
  userId: UUID,
  overrides: Partial<typeof loginTokens.$inferInsert> = {},
) {
  const [row] = await db
    .insert(loginTokens)
    .values({
      token: `tok_${uniq()}`.slice(0, 32),
      userId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('insert returned no rows');
  return row;
}

export async function createVenue(
  overrides: Partial<typeof venues.$inferInsert> = {},
) {
  const [row] = await db
    .insert(venues)
    .values({ name: `Venue ${uniq()}`, address: 'Test address', ...overrides })
    .returning();
  if (!row) throw new Error('insert returned no rows');
  return row;
}

/**
 * Insert a tournament. A venue and creator are auto-created when not supplied
 * (both are NOT NULL foreign keys). Defaults to a public single-elimination
 * snooker draft; override `visibility`/`status`/etc. as needed.
 */
export async function createTournament(
  overrides: Partial<typeof tournaments.$inferInsert> = {},
) {
  const venueId = overrides.venueId ?? (await createVenue()).id;
  const createdBy = overrides.createdBy ?? (await createUser()).id;

  const [row] = await db
    .insert(tournaments)
    .values({
      name: `Tournament ${uniq()}`,
      discipline: 'snooker',
      format: 'single_elimination',
      ...overrides,
      venueId,
      createdBy,
    })
    .returning();
  if (!row) throw new Error('insert returned no rows');
  return row;
}
