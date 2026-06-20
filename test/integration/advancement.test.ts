import type { UUID } from 'crypto';

import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db/db.js';
import { matches, tables, tournamentTables } from '@/db/schema.js';
import type { MatchWithPlayers } from '@/bot/@types/match.js';
import {
  confirmResult,
  correctMatchResult,
  getTournamentMatches,
  reportResult,
} from '@/services/matchService.js';
import { getTournament } from '@/services/tournamentService.js';
import { bot } from '@/bot/instance.js';

import {
  completeMatch,
  createMatchesForTournament,
  createTournamentWithParticipants,
  createVenue,
  playAllReady,
} from '../helpers/factories.js';
import { must, positionLookup } from '../helpers/must.js';
import { truncateAll } from '../helpers/truncate.js';

function loserOf(match: MatchWithPlayers): UUID {
  const winner = must(match.winnerId, 'winnerId');
  const p1 = must(match.player1Id, 'player1Id');
  const p2 = must(match.player2Id, 'player2Id');
  return p1 === winner ? p2 : p1;
}

describe('advanceWinner propagation (S7-2)', () => {
  beforeAll(() => {
    vi.spyOn(bot.api, 'sendMessage').mockResolvedValue(
      {} as Awaited<ReturnType<typeof bot.api.sendMessage>>,
    );
  });

  beforeEach(async () => {
    await truncateAll();
  });

  describe('single elimination', () => {
    it('advances winners into the correct next-match slots and completes', async () => {
      const { tournament } = await createTournamentWithParticipants(
        4,
        'single_elimination',
      );
      await createMatchesForTournament(tournament.id, 'single_elimination');

      let pos = await positionLookup(tournament.id);
      const r1a = pos(1);
      const r1b = pos(2);
      const winnerA = must(r1a.player1Id);
      const winnerB = must(r1b.player1Id);

      // pos 1 → final player1, pos 2 → final player2.
      await completeMatch(r1a.id, winnerA);
      pos = await positionLookup(tournament.id);
      expect(pos(3).player1Id).toBe(winnerA);

      await completeMatch(r1b.id, winnerB);
      pos = await positionLookup(tournament.id);
      expect(pos(3).player2Id).toBe(winnerB);

      // Final completes the tournament (advanceWinner !nextMatchId branch).
      await completeMatch(pos(3).id, winnerA);
      expect((await getTournament(tournament.id))?.status).toBe('completed');
    });
  });

  describe('double elimination loser routing (16 players, no walkovers)', () => {
    it('routes losers and winners per the loserTarget formula', async () => {
      const { tournament } = await createTournamentWithParticipants(
        16,
        'double_elimination',
      );
      await createMatchesForTournament(tournament.id, 'double_elimination');

      let pos = await positionLookup(tournament.id);
      const m1 = pos(1);
      const m2 = pos(2);
      const w1 = must(m1.player1Id);
      const w2 = must(m2.player1Id);

      // pos 1 (odd, round 1): loser → losers pos 9 player1; winner → pos 13 player1.
      await completeMatch(m1.id, w1);
      pos = await positionLookup(tournament.id);
      expect(pos(9).player1Id).toBe(loserOf(pos(1)));
      expect(pos(13).player1Id).toBe(w1);

      // pos 2 (even, round 1): loser → losers pos 9 player2; winner → pos 13 player2.
      await completeMatch(m2.id, w2);
      pos = await positionLookup(tournament.id);
      expect(pos(9).player2Id).toBe(loserOf(pos(2)));
      expect(pos(13).player2Id).toBe(w2);

      // pos 13 (round 2 winners): loser → losers pos 17 player2.
      const m13 = pos(13);
      await completeMatch(m13.id, must(m13.player1Id));
      pos = await positionLookup(tournament.id);
      expect(pos(17).player2Id).toBe(loserOf(pos(13)));
    });
  });

  describe('walkovers in a 12-player double elimination', () => {
    it('pre-completes gen-time walkovers and marks downstream loser slots', async () => {
      const { tournament } = await createTournamentWithParticipants(
        12,
        'double_elimination',
      );
      await createMatchesForTournament(tournament.id, 'double_elimination');

      const pos = await positionLookup(tournament.id);
      for (const p of [1, 3, 5, 7]) {
        const m = pos(p);
        expect(m.status).toBe('completed');
        expect(m.isTechnicalResult).toBe(true);
        expect(m.technicalReason).toBe('walkover');
        expect(m.winnerId).not.toBeNull();
      }
      // Each gen-time walkover marked player1 of its R1-lower match.
      for (const p of [9, 10, 11, 12]) {
        expect(pos(p).player1IsWalkover).toBe(true);
      }
    });

    it('auto-resolves a runtime walkover when a real loser lands opposite a bye', async () => {
      const { tournament } = await createTournamentWithParticipants(
        12,
        'double_elimination',
      );
      await createMatchesForTournament(tournament.id, 'double_elimination');

      let pos = await positionLookup(tournament.id);
      const m2 = pos(2); // first real R1-upper match
      const loser = must(m2.player2Id);

      // pos 2 loser → losers pos 9 player2, whose player1 is walkover-bound.
      await completeMatch(m2.id, must(m2.player1Id));

      pos = await positionLookup(tournament.id);
      const lower9 = pos(9);
      expect(lower9.player2Id).toBe(loser);
      expect(lower9.status).toBe('completed');
      expect(lower9.winnerId).toBe(loser);
      expect(lower9.technicalReason).toBe('walkover');
    });
  });

  describe('createMatches', () => {
    it('links nextMatchId by position and pre-completes walkover rows', async () => {
      const { tournament } = await createTournamentWithParticipants(
        4,
        'single_elimination',
      );
      await createMatchesForTournament(tournament.id, 'single_elimination');

      const pos = await positionLookup(tournament.id);
      // R1 matches point at the final's UUID.
      expect(pos(1).nextMatchId).toBe(pos(3).id);
      expect(pos(2).nextMatchId).toBe(pos(3).id);
      expect(pos(3).nextMatchId).toBeNull();
    });
  });

  describe('table release', () => {
    it('hands a freed table to the next ready match on completion', async () => {
      const { tournament } = await createTournamentWithParticipants(
        4,
        'single_elimination',
      );
      await createMatchesForTournament(tournament.id, 'single_elimination');

      // One table linked to the tournament.
      const venue = await createVenue();
      const [table] = await db
        .insert(tables)
        .values({ name: 'Стол 1', venueId: venue.id })
        .returning();
      const tableId = must(table, 'table').id;
      await db
        .insert(tournamentTables)
        .values({ tournamentId: tournament.id, tableId });

      // Put pos 1 on the table, then complete it with a bot api present.
      let pos = await positionLookup(tournament.id);
      const m1 = pos(1);
      await db
        .update(matches)
        .set({ tableId, status: 'in_progress' })
        .where(eq(matches.id, m1.id));

      await reportResult(m1.id, must(m1.player2Id), 0, 3); // player2 wins
      await confirmResult(m1.id, must(m1.player1Id), bot.api);

      pos = await positionLookup(tournament.id);
      // pos 2 is the next ready match — it should inherit the freed table.
      expect(pos(2).tableId).toBe(tableId);
      expect(pos(2).status).toBe('in_progress');
    });
  });

  describe('round robin', () => {
    it('does not route and completes only when all matches are done', async () => {
      const { tournament } = await createTournamentWithParticipants(
        3,
        'round_robin',
      );
      await createMatchesForTournament(tournament.id, 'round_robin');

      const all = await getTournamentMatches(tournament.id);
      expect(all).toHaveLength(3);
      expect(all.every((m) => m.nextMatchId === null)).toBe(true);

      const m0 = must(all[0]);
      const m1 = must(all[1]);
      const m2 = must(all[2]);

      // Complete the first two — tournament stays in progress.
      await completeMatch(m0.id, must(m0.player1Id));
      expect((await getTournament(tournament.id))?.status).toBe('in_progress');
      await completeMatch(m1.id, must(m1.player1Id));
      expect((await getTournament(tournament.id))?.status).toBe('in_progress');

      // The last match completes the tournament.
      await completeMatch(m2.id, must(m2.player1Id));
      expect((await getTournament(tournament.id))?.status).toBe('completed');
    });
  });

  describe('generalized double elimination (configurable merge round)', () => {
    it.each([
      [8, 2, 13],
      [8, 3, 14],
      [16, 4, 30],
      [32, 2, 55],
    ])(
      'plays a full %i-player bracket (mergeRound %i) to completion (%i matches)',
      async (count, mergeRound, expectedMatches) => {
        const { tournament } = await createTournamentWithParticipants(
          count,
          'double_elimination',
          { mergeRound },
        );
        await createMatchesForTournament(tournament.id, 'double_elimination');

        const all = await getTournamentMatches(tournament.id);
        expect(all).toHaveLength(expectedMatches);

        await playAllReady(tournament.id, 'double_elimination');
        expect((await getTournament(tournament.id))?.status).toBe('completed');
      },
    );

    it('persists losersNextMatchSlot on winners-bracket drop matches', async () => {
      const { tournament } = await createTournamentWithParticipants(
        16,
        'double_elimination',
      );
      await createMatchesForTournament(tournament.id, 'double_elimination');

      const rows = await db
        .select()
        .from(matches)
        .where(eq(matches.tournamentId, tournament.id));
      const r1 = rows.find((m) => m.bracketType === 'winners' && m.round === 1);
      expect(r1?.losersNextMatchPosition).not.toBeNull();
      expect(['player1', 'player2']).toContain(r1?.losersNextMatchSlot);
    });

    it('routes an upper round-3 loser into the deeper losers bracket (N=16, M=3)', async () => {
      const { tournament } = await createTournamentWithParticipants(
        16,
        'double_elimination',
        { mergeRound: 3 },
      );
      await createMatchesForTournament(tournament.id, 'double_elimination');

      // Drive upper rounds 1 and 2 so an upper round-3 match has both players.
      const advanceWinners = async (): Promise<void> => {
        const open = (await getTournamentMatches(tournament.id)).filter(
          (m) =>
            m.bracketType === 'winners' &&
            m.round <= 2 &&
            m.player1Id !== null &&
            m.player2Id !== null &&
            m.status === 'scheduled',
        );
        for (const m of open) await completeMatch(m.id, must(m.player1Id));
      };
      await advanceWinners();
      await advanceWinners();

      const r3 = (await getTournamentMatches(tournament.id)).find(
        (m) => m.bracketType === 'winners' && m.round === 3,
      );
      const r3match = must(r3, 'upper round 3 match');
      const loser = must(r3match.player2Id, 'r3 player2');
      await completeMatch(r3match.id, must(r3match.player1Id));

      // The loser drops into a losers-bracket match in LB round 2*(3-1) = 4.
      const lbRow = (await getTournamentMatches(tournament.id)).find(
        (m) =>
          m.bracketType === 'losers' &&
          (m.player1Id === loser || m.player2Id === loser),
      );
      expect(must(lbRow, 'losers drop match').round).toBe(4);
    });

    it('cascades a corrected upstream result across the merge boundary', async () => {
      const { tournament } = await createTournamentWithParticipants(
        8,
        'double_elimination',
        { mergeRound: 2 },
      );
      await createMatchesForTournament(tournament.id, 'double_elimination');
      await playAllReady(tournament.id, 'double_elimination');
      expect((await getTournament(tournament.id))?.status).toBe('completed');

      // Flip the winner of the first upper match; downstream (incl. across the
      // merge) must roll back. playAllReady made player1 win, so make player2 win.
      const pos = await positionLookup(tournament.id);
      const m1 = pos(1);
      const winScore = must((await getTournament(tournament.id))?.winScore);
      const player1Won = m1.winnerId === m1.player1Id;
      const result = await correctMatchResult(
        m1.id,
        player1Won ? 0 : winScore,
        player1Won ? winScore : 0,
        'test correction',
        must(m1.player1Id),
      );
      expect(result.success).toBe(true);
      expect(result.winnerChanged).toBe(true);
      expect(result.affectedCount ?? 0).toBeGreaterThan(0);
    });

    it.each([2, 3])(
      'completes a random-advancement bracket (mergeRound %i) and clears loser pointers',
      async (mergeRound) => {
        const { tournament } = await createTournamentWithParticipants(
          16,
          'double_elimination',
          { mergeRound, randomAdvancement: true },
        );
        await createMatchesForTournament(tournament.id, 'double_elimination');

        const rows = await db
          .select()
          .from(matches)
          .where(eq(matches.tournamentId, tournament.id));
        for (const m of rows) {
          expect(m.losersNextMatchPosition).toBeNull();
          expect(m.losersNextMatchSlot).toBeNull();
          expect(m.nextMatchId).toBeNull();
        }

        await playAllReady(tournament.id, 'double_elimination');
        expect((await getTournament(tournament.id))?.status).toBe('completed');
      },
    );
  });
});
