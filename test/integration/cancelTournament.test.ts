import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/db.js';
import { matches } from '@/db/schema.js';
import type { MatchStatus } from '@/db/schema.js';
import { cancelTournament, getTournament } from '@/services/tournamentService.js';

import { createTournament } from '../helpers/factories.js';
import { truncateAll } from '../helpers/truncate.js';

/** Insert a bare match row in the given status. */
async function addMatch(
  tournamentId: string,
  position: number,
  status: MatchStatus,
) {
  await db
    .insert(matches)
    .values({ tournamentId, round: 1, position, status });
}

describe('cancelTournament', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('flips the tournament to cancelled', async () => {
    const t = await createTournament({ status: 'in_progress' });

    await cancelTournament(t.id);

    const read = await getTournament(t.id);
    expect(read?.status).toBe('cancelled');
  });

  it('cancels unfinished matches but leaves completed ones untouched', async () => {
    const t = await createTournament({ status: 'in_progress' });
    await addMatch(t.id, 1, 'scheduled');
    await addMatch(t.id, 2, 'in_progress');
    await addMatch(t.id, 3, 'pending_confirmation');
    await addMatch(t.id, 4, 'completed');

    await cancelTournament(t.id);

    const rows = await db.query.matches.findMany({});
    const byPosition = new Map(rows.map((m) => [m.position, m.status]));

    expect(byPosition.get(1)).toBe('cancelled');
    expect(byPosition.get(2)).toBe('cancelled');
    expect(byPosition.get(3)).toBe('cancelled');
    expect(byPosition.get(4)).toBe('completed');
  });

  it('does not touch matches of other tournaments', async () => {
    const target = await createTournament({ status: 'in_progress' });
    const other = await createTournament({ status: 'in_progress' });
    await addMatch(target.id, 1, 'scheduled');
    await addMatch(other.id, 1, 'scheduled');

    await cancelTournament(target.id);

    const rows = await db.query.matches.findMany({});
    const otherMatch = rows.find((m) => m.tournamentId === other.id);
    expect(otherMatch?.status).toBe('scheduled');
  });
});
