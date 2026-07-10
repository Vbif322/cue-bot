import type { UUID } from 'crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  getPlayerActiveMatches,
  getPlayerMatchHistory,
  getTournamentMatches,
} from '@/services/matchService.js';

import {
  completeMatch,
  createMatchesForTournament,
  createTournamentWithParticipants,
} from '../helpers/factories.js';
import { must } from '../helpers/must.js';
import { truncateAll } from '../helpers/truncate.js';

/**
 * Guardrail for the N+1 → single-query refactor of `getPlayerActiveMatches` and
 * `getPlayerMatchHistory`: pins the current behaviour (which matches, in what
 * order, with joined player/table fields) so the rewrite can't silently drift.
 */

/** A started 4-player single-elimination tournament (2 semis + a final). */
async function fourPlayerSE(): Promise<{ tournamentId: UUID; players: UUID[] }> {
  const { tournament, participantIds } = await createTournamentWithParticipants(
    4,
    'single_elimination',
  );
  await createMatchesForTournament(tournament.id, 'single_elimination');
  return { tournamentId: tournament.id, players: participantIds };
}

describe('getPlayerActiveMatches', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns the participant’s active match with joined player fields', async () => {
    const { tournamentId, players } = await fourPlayerSE();
    const p = must(players[0], 'p');
    const all = await getTournamentMatches(tournamentId);
    const semi = must(
      all.find((m) => m.round === 1 && (m.player1Id === p || m.player2Id === p)),
      'semi',
    );

    const active = await getPlayerActiveMatches(p);
    expect(active).toHaveLength(1);
    const a = must(active[0], 'active');
    expect(a.id).toBe(semi.id);
    expect(a.status).toBe('scheduled');
    // Joined columns are present (username populated by the factory user).
    expect(a).toHaveProperty('tableName');
    expect(a.player1Username).toBeTruthy();
    expect(a.player2Username).toBeTruthy();
  });

  it('excludes completed matches and follows the winner forward', async () => {
    const { tournamentId, players } = await fourPlayerSE();
    const p = must(players[0], 'p');
    const all = await getTournamentMatches(tournamentId);
    const semi = must(
      all.find((m) => m.round === 1 && (m.player1Id === p || m.player2Id === p)),
      'semi',
    );

    await completeMatch(semi.id, p);

    const active = await getPlayerActiveMatches(p);
    expect(active).toHaveLength(1);
    const a = must(active[0], 'active');
    expect(a.round).toBe(2); // now in the final
    expect(a.status).not.toBe('completed'); // completed semi is not returned
  });
});

describe('getPlayerMatchHistory', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns completed matches newest-first with joined fields and respects limit', async () => {
    const { tournamentId, players } = await fourPlayerSE();
    const p = must(players[0], 'p');
    const all = await getTournamentMatches(tournamentId);
    const semi = must(
      all.find((m) => m.round === 1 && (m.player1Id === p || m.player2Id === p)),
      'semi',
    );
    const otherSemi = must(
      all.find((m) => m.round === 1 && m.id !== semi.id),
      'otherSemi',
    );

    await completeMatch(semi.id, p); // p wins its semi
    await completeMatch(otherSemi.id, must(otherSemi.player1Id, 'otherWinner'));
    const final = must(
      (await getTournamentMatches(tournamentId)).find((m) => m.round === 2),
      'final',
    );
    await completeMatch(final.id, p); // p wins the final

    const history = await getPlayerMatchHistory(p);
    expect(history).toHaveLength(2);
    // completedAt desc → final (round 2, latest) before semi (round 1).
    expect(history.map((m) => m.round)).toEqual([2, 1]);
    expect(history.every((m) => m.status === 'completed')).toBe(true);
    // Joined columns populated.
    expect(history[0]?.player1Username).toBeTruthy();
    expect(history[0]).toHaveProperty('tableName');

    const limited = await getPlayerMatchHistory(p, { limit: 1 });
    expect(limited).toHaveLength(1);
    expect(limited[0]?.round).toBe(2);
  });
});
