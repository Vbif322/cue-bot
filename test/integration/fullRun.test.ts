import { beforeEach, describe, expect, it } from 'vitest';

import { getTournamentMatches } from '@/services/matchService.js';
import { getTournament } from '@/services/tournamentService.js';

import {
  createMatchesForTournament,
  createTournamentWithParticipants,
  playAllReady,
} from '../helpers/factories.js';
import { truncateAll } from '../helpers/truncate.js';

describe('full tournament run-throughs', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  describe('round robin', () => {
    for (const n of [3, 4, 5]) {
      it(`plays every pair once and completes (${String(n)} players)`, async () => {
        const { tournament, participantIds } =
          await createTournamentWithParticipants(n, 'round_robin');
        await createMatchesForTournament(tournament.id, 'round_robin');

        const all = await getTournamentMatches(tournament.id);
        expect(all).toHaveLength((n * (n - 1)) / 2);

        // Each player meets every other exactly once → n-1 appearances.
        for (const id of participantIds) {
          const appearances = all.filter(
            (m) => m.player1Id === id || m.player2Id === id,
          ).length;
          expect(appearances).toBe(n - 1);
        }

        await playAllReady(tournament.id, 'round_robin');
        expect((await getTournament(tournament.id))?.status).toBe('completed');
      });
    }
  });

  describe('single elimination with byes', () => {
    // 6 players → bracket of 8 (2 byes). ("4 in 8" from the task is impossible:
    // getNextPowerOfTwo(4) === 4. 6 forces byes while leaving real R1 matches.)
    it('auto-advances byes and crowns a single champion', async () => {
      const { tournament } = await createTournamentWithParticipants(
        6,
        'single_elimination',
      );
      await createMatchesForTournament(tournament.id, 'single_elimination');

      const r1 = (await getTournamentMatches(tournament.id)).filter(
        (m) => m.round === 1,
      );
      // Bye matches stay scheduled with exactly one player (S4-2 phantom byes).
      const byeMatches = r1.filter(
        (m) => (m.player1Id === null) !== (m.player2Id === null), // exactly one set
      );
      expect(byeMatches.length).toBeGreaterThan(0);
      for (const bye of byeMatches) {
        expect(bye.status).toBe('scheduled');
      }

      await playAllReady(tournament.id, 'single_elimination');

      expect((await getTournament(tournament.id))?.status).toBe('completed');
      const all = await getTournamentMatches(tournament.id);
      const final = all.find((m) => m.nextMatchId === null);
      expect(final?.status).toBe('completed');
      expect(final?.winnerId).not.toBeNull();
    });
  });
});
