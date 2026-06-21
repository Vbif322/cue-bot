import type { UUID } from 'crypto';

import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/db.js';
import { matches } from '@/db/schema.js';
import { advanceWinner } from '@/services/matchService.js';
import { getTournament } from '@/services/tournamentService.js';

import { createTournament, createUser } from '../helpers/factories.js';
import { truncateAll } from '../helpers/truncate.js';

/** Insert a round-robin match (no nextMatchId) between two players. */
async function addRrMatch(
  tournamentId: UUID,
  position: number,
  player1Id: UUID,
  player2Id: UUID,
) {
  const [row] = await db
    .insert(matches)
    .values({
      tournamentId,
      round: 1,
      position,
      player1Id,
      player2Id,
      status: 'in_progress',
    })
    .returning();
  if (!row) throw new Error('insert returned no rows');
  return row;
}

/** Mark a match completed with the given winner, then advance. */
async function completeAndAdvance(
  match: Awaited<ReturnType<typeof addRrMatch>>,
  winnerId: typeof match.player1Id,
) {
  await db
    .update(matches)
    .set({ winnerId, status: 'completed', completedAt: new Date() })
    .where(eq(matches.id, match.id));
  await advanceWinner(match.id);
}

describe('round-robin completion (S4-1)', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('completes only after every match is played, not the first one', async () => {
    const t = await createTournament({
      status: 'in_progress',
      format: 'round_robin',
    });
    const [p1, p2, p3] = await Promise.all([
      createUser(),
      createUser(),
      createUser(),
    ]);

    // 3 players → 3 RR matches.
    const m12 = await addRrMatch(t.id, 1, p1.id, p2.id);
    const m13 = await addRrMatch(t.id, 2, p1.id, p3.id);
    const m23 = await addRrMatch(t.id, 3, p2.id, p3.id);

    // First confirmed match must NOT end the tournament.
    await completeAndAdvance(m12, p1.id);
    expect((await getTournament(t.id))?.status).toBe('in_progress');

    // Second still leaves one match outstanding.
    await completeAndAdvance(m13, p1.id);
    expect((await getTournament(t.id))?.status).toBe('in_progress');

    // Last match completes the tournament.
    await completeAndAdvance(m23, p2.id);
    expect((await getTournament(t.id))?.status).toBe('completed');
  });
});
