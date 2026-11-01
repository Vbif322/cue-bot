import type { UUID } from 'crypto';
import { beforeEach, describe, expect, it } from 'vitest';

import { generateBracket } from '@/services/bracketGenerator.js';
import {
  createMatches,
  getTournamentMatches,
} from '@/services/matchService.js';
import { getFinalPlacements } from '@/services/placementService.js';
import type { PlacementGroup } from '@/services/placementService.js';
import {
  getConfirmedParticipantsBySeed,
  getTournament,
  startTournament,
} from '@/services/tournamentService.js';
import type { ITournamentFormat } from '@/shared/tournament/formats.js';

import {
  completeMatch,
  createConfirmedParticipant,
  createMatchesForTournament,
  createTournament,
  createTournamentWithParticipants,
  playAllReady,
} from '../helpers/factories.js';
import { must } from '../helpers/must.js';
import { truncateAll } from '../helpers/truncate.js';

/** Places run 1..n without gaps and every participant is placed once. */
function expectWellFormed(groups: PlacementGroup[], participantIds: UUID[]) {
  let next = 1;
  for (const g of groups) {
    expect(g.placeFrom).toBe(next);
    expect(g.placeTo - g.placeFrom + 1).toBe(g.userIds.length);
    next = g.placeTo + 1;
  }
  expect(groups.flatMap((g) => g.userIds).sort()).toEqual(
    [...participantIds].sort(),
  );
}

async function playedOut(
  count: number,
  format: ITournamentFormat,
  opts: Parameters<typeof createTournamentWithParticipants>[2] = {},
) {
  const { tournament, participantIds } = await createTournamentWithParticipants(
    count,
    format,
    opts,
  );
  await createMatchesForTournament(tournament.id, format);
  await playAllReady(tournament.id, format);
  const finished = must(await getTournament(tournament.id), 'tournament');
  expect(finished.status).toBe('completed');
  return { tournament: finished, participantIds };
}

describe('getFinalPlacements on real runs', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('single elimination with byes (6 players)', async () => {
    const { tournament, participantIds } = await playedOut(
      6,
      'single_elimination',
    );
    const groups = await getFinalPlacements(tournament);

    expectWellFormed(groups, participantIds);
    expect(groups.map((g) => g.userIds.length)).toEqual([1, 1, 2, 2]);
  });

  it.each([
    [12, 2, false],
    [16, 3, false],
    [16, 3, true],
  ])(
    'double elimination: %i players, merge round %i, random advancement %s',
    async (count, mergeRound, randomAdvancement) => {
      const { tournament, participantIds } = await playedOut(
        count,
        'double_elimination',
        { mergeRound, randomAdvancement },
      );
      const groups = await getFinalPlacements(tournament);

      expectWellFormed(groups, participantIds);
      expect(groups[0]?.userIds).toHaveLength(1);
      expect(groups[1]?.userIds).toHaveLength(1);
    },
  );

  it('round robin follows the standings', async () => {
    const { tournament, participantIds } = await playedOut(5, 'round_robin');
    const groups = await getFinalPlacements(tournament);

    expectWellFormed(groups, participantIds);
    expect(groups.every((g) => g.userIds.length === 1)).toBe(true);
  });

  it('groups + playoff: group leftovers share places below the playoff', async () => {
    const config = {
      groupsCount: 2,
      participantsPerGroup: 4,
      qualifiersPerGroup: 2,
      groupDraw: 'snake' as const,
    };
    const tournament = await createTournament({
      format: 'groups_playoff',
      status: 'registration_open',
      ...config,
    });
    const participantIds: UUID[] = [];
    for (let seed = 1; seed <= 8; seed++) {
      participantIds.push(
        (await createConfirmedParticipant(tournament.id, { seed })).userId,
      );
    }
    const bracket = generateBracket(
      'groups_playoff',
      await getConfirmedParticipantsBySeed(tournament.id),
      false,
      2,
      config,
    );
    await createMatches(tournament.id, bracket, {
      winScore: 3,
      stageWinScores: null,
    });
    await startTournament(tournament.id);

    // Group phase, then the generated playoff (player1 wins every match).
    for (let i = 0; i < 200; i++) {
      const ready = (await getTournamentMatches(tournament.id)).find(
        (m) =>
          m.player1Id !== null &&
          m.player2Id !== null &&
          (m.status === 'scheduled' || m.status === 'in_progress'),
      );
      if (!ready) break;
      await completeMatch(ready.id, must(ready.player1Id, 'player1Id'));
    }
    const finished = must(await getTournament(tournament.id), 'tournament');
    expect(finished.status).toBe('completed');

    const groups = await getFinalPlacements(finished);
    expectWellFormed(groups, participantIds);
    // 1, 2, 3–4 from the 4-player playoff; then both 3rd and both 4th places.
    expect(groups.map((g) => [g.placeFrom, g.placeTo])).toEqual([
      [1, 1],
      [2, 2],
      [3, 4],
      [5, 6],
      [7, 8],
    ]);
  });
});
