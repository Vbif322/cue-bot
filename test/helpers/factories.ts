import { db } from '@/db/db.js';
import { users, venues } from '@/db/schema.js';

/**
 * Test-data factories. Phase 0b ships the two leaf entities needed to validate
 * the harness; tournament/match/participant factories are added in Phase 2.
 */
let seq = 0;
const uniq = (): string => `${Date.now().toString(36)}_${seq++}`;

export async function createUser(
  overrides: Partial<typeof users.$inferInsert> = {},
) {
  const [row] = await db
    .insert(users)
    .values({ username: `user_${uniq()}`, ...overrides })
    .returning();
  return row!;
}

export async function createVenue(
  overrides: Partial<typeof venues.$inferInsert> = {},
) {
  const [row] = await db
    .insert(venues)
    .values({ name: `Venue ${uniq()}`, address: 'Test address', ...overrides })
    .returning();
  return row!;
}
