import type { UUID } from 'crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/db.js';
import { tables, tournamentTables } from '@/db/schema.js';
import {
  assignTableAndStart,
  confirmResult,
  disputeResult,
  getMatch,
  reportResult,
} from '@/services/matchService.js';

import {
  createMatchesForTournament,
  createTournamentWithParticipants,
  createVenue,
} from '../helpers/factories.js';
import { must } from '../helpers/must.js';
import { truncateAll } from '../helpers/truncate.js';

/**
 * A fresh single-match 2-player single-elimination tournament. The lone match is
 * `scheduled` with both players assigned and no table — the final, so advancing a
 * winner just completes the tournament (no next match).
 */
async function freshMatch(
  venueId?: UUID,
): Promise<{ matchId: UUID; tournamentId: UUID; p1: UUID; p2: UUID }> {
  const { tournament, participantIds } = await createTournamentWithParticipants(
    2,
    'single_elimination',
    venueId ? { venueId } : {},
  );
  const all = await createMatchesForTournament(
    tournament.id,
    'single_elimination',
  );
  const match = must(all[0], 'match');
  return {
    matchId: match.id,
    tournamentId: tournament.id,
    p1: must(participantIds[0], 'seed1'),
    p2: must(participantIds[1], 'seed2'),
  };
}

describe('matchService concurrency (race-safe paths)', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('double confirm: two players confirm at once → exactly one succeeds', async () => {
    const { matchId, p1, p2 } = await freshMatch();
    // Report a 3-0 win for player1 so the match awaits confirmation.
    expect((await reportResult(matchId, p1, 3, 0)).success).toBe(true);

    const [a, b] = await Promise.all([
      confirmResult(matchId, p1),
      confirmResult(matchId, p2),
    ]);

    const successes = [a, b].filter((r) => r.success);
    const failures = [a, b].filter((r) => !r.success);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    // The loser is rejected either at the read-side status guard (saw `completed`)
    // or at the conditional UPDATE (photo-finish) — both are valid race outcomes.
    expect(failures[0]?.error).toMatch(
      /Статус матча изменился|Матч не ожидает подтверждения/,
    );

    const after = await getMatch(matchId);
    expect(after?.status).toBe('completed');
    expect(after?.winnerId).toBe(p1);
  });

  it('confirm vs dispute at once → exactly one wins, status not corrupted', async () => {
    const { matchId, p1, p2 } = await freshMatch();
    expect((await reportResult(matchId, p1, 3, 0)).success).toBe(true);

    const [confirm, dispute] = await Promise.all([
      confirmResult(matchId, p1),
      disputeResult(matchId, p2),
    ]);

    // Exactly one of the two transitions claimed the pending_confirmation row.
    const successes = [confirm, dispute].filter((r) => r.success);
    expect(successes).toHaveLength(1);

    const after = await getMatch(matchId);
    if (confirm.success) {
      // Confirm won the race → completed with the reported winner intact.
      expect(after?.status).toBe('completed');
      expect(after?.winnerId).toBe(p1);
    } else {
      // Dispute won the race → back to in_progress with the result wiped.
      expect(after?.status).toBe('in_progress');
      expect(after?.winnerId).toBeNull();
      expect(after?.player1Score).toBeNull();
      expect(after?.player2Score).toBeNull();
    }
  });

  it('table race: two assignTableAndStart on one match → exactly one wins the table', async () => {
    const venue = await createVenue();
    const { matchId, tournamentId } = await freshMatch(venue.id);

    const [table] = await db
      .insert(tables)
      .values({ name: 'Стол 1', venueId: venue.id })
      .returning();
    const tableId = must(table, 'table').id;

    await db
      .insert(tournamentTables)
      .values({ tournamentId, tableId, position: 0 });

    const [a, b] = await Promise.all([
      assignTableAndStart(matchId, tableId),
      assignTableAndStart(matchId, tableId),
    ]);

    expect([a, b].filter(Boolean)).toHaveLength(1);

    const after = await getMatch(matchId);
    expect(after?.status).toBe('in_progress');
    expect(after?.tableId).toBe(tableId);
  });
});
