import type { UUID } from 'crypto';

import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/db.js';
import { matches, matchCorrections } from '@/db/schema.js';
import {
  correctMatchResult,
  previewCorrection,
  resyncAdvancement,
} from '@/services/matchService.js';
import { getTournament } from '@/services/tournamentService.js';

import {
  completeMatch,
  createAdminUser,
  createMatchesForTournament,
  createTournamentWithParticipants,
} from '../helpers/factories.js';
import { must, positionLookup } from '../helpers/must.js';
import { truncateAll } from '../helpers/truncate.js';

const MISSING_ID = '00000000-0000-0000-0000-000000000000' as UUID;

/** A 4-player single-elimination tournament with matches created. */
async function se4(): Promise<UUID> {
  const { tournament } = await createTournamentWithParticipants(
    4,
    'single_elimination',
  );
  await createMatchesForTournament(tournament.id, 'single_elimination');
  return tournament.id;
}

describe('result correction cascade (S7-2)', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  describe('previewCorrection', () => {
    it('reports no change when the winner is unchanged', async () => {
      const tid = await se4();
      const m1 = (await positionLookup(tid))(1);
      await completeMatch(m1.id, must(m1.player1Id)); // 3-0, player1 wins

      const preview = await previewCorrection(m1.id, 3, 1); // still player1
      expect(preview.valid).toBe(true);
      expect(preview.winnerChanged).toBe(false);
      expect(preview.affectedCount).toBe(0);
    });

    it('counts downstream matches when the winner flips', async () => {
      const tid = await se4();
      const m1 = (await positionLookup(tid))(1);
      await completeMatch(m1.id, must(m1.player1Id));

      const preview = await previewCorrection(m1.id, 0, 3); // flip to player2
      expect(preview.valid).toBe(true);
      expect(preview.winnerChanged).toBe(true);
      expect(preview.affectedCount).toBe(1); // the final holds the old winner
      expect(preview.tournamentWillReopen).toBe(false);
    });

    it('flags a reopen when correcting after the tournament completed', async () => {
      const tid = await se4();
      let pos = await positionLookup(tid);
      await completeMatch(pos(1).id, must(pos(1).player1Id));
      await completeMatch(pos(2).id, must(pos(2).player1Id));
      pos = await positionLookup(tid);
      await completeMatch(pos(3).id, must(pos(3).player1Id));
      expect((await getTournament(tid))?.status).toBe('completed');

      const final = (await positionLookup(tid))(3);
      const preview = await previewCorrection(final.id, 0, 3); // flip the final
      expect(preview.winnerChanged).toBe(true);
      expect(preview.tournamentWillReopen).toBe(true);
    });

    it('rejects an unfinished match and an invalid score', async () => {
      const tid = await se4();
      const m1 = (await positionLookup(tid))(1);

      const notDone = await previewCorrection(m1.id, 3, 0);
      expect(notDone).toMatchObject({
        valid: false,
        error: 'Корректировать можно только завершённый матч',
      });

      await completeMatch(m1.id, must(m1.player1Id));
      const badScore = await previewCorrection(m1.id, 2, 1);
      expect(badScore).toMatchObject({
        valid: false,
        error: 'Один из игроков должен набрать 3 побед',
      });
    });
  });

  describe('correctMatchResult', () => {
    it('edits the score only when the winner is unchanged', async () => {
      const tid = await se4();
      const m1 = (await positionLookup(tid))(1);
      const admin = await createAdminUser();
      await completeMatch(m1.id, must(m1.player1Id)); // 3-0

      const res = await correctMatchResult(m1.id, 3, 1, 'опечатка', admin.id);
      expect(res).toMatchObject({
        success: true,
        winnerChanged: false,
        affectedCount: 0,
      });

      const pos = await positionLookup(tid);
      expect(pos(1).player1Score).toBe(3);
      expect(pos(1).player2Score).toBe(1);
      expect(pos(1).isCorrected).toBe(true);
      // The final still holds the unchanged winner.
      expect(pos(3).player1Id).toBe(m1.player1Id);
    });

    it('rolls back downstream and re-advances the new winner on a flip', async () => {
      const tid = await se4();
      const admin = await createAdminUser();
      const m1 = (await positionLookup(tid))(1);
      const oldWinner = must(m1.player1Id);
      const newWinner = must(m1.player2Id);
      await completeMatch(m1.id, oldWinner); // final.player1 = oldWinner

      const res = await correctMatchResult(m1.id, 0, 3, 'пересмотр', admin.id);
      expect(res).toMatchObject({
        success: true,
        winnerChanged: true,
        affectedCount: 1,
      });

      const pos = await positionLookup(tid);
      // Downstream slot now carries the new winner.
      expect(pos(3).player1Id).toBe(newWinner);

      const audit = await db.query.matchCorrections.findMany({
        where: eq(matchCorrections.matchId, m1.id),
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]?.affectedMatchIds).toContain(pos(3).id);
    });

    it('reopens a completed tournament when correcting an upstream match', async () => {
      const tid = await se4();
      const admin = await createAdminUser();
      let pos = await positionLookup(tid);
      const m1 = pos(1);
      const newWinner = must(m1.player2Id);

      await completeMatch(pos(1).id, must(pos(1).player1Id));
      await completeMatch(pos(2).id, must(pos(2).player1Id));
      pos = await positionLookup(tid);
      await completeMatch(pos(3).id, must(pos(3).player1Id));
      expect((await getTournament(tid))?.status).toBe('completed');

      // Flip a round-1 result: the final is reset (not replayed) so the
      // tournament must stay reopened.
      const res = await correctMatchResult(m1.id, 0, 3, 'апелляция', admin.id);
      expect(res.winnerChanged).toBe(true);
      expect((await getTournament(tid))?.status).toBe('in_progress');

      pos = await positionLookup(tid);
      expect(pos(3).status).toBe('scheduled');
      expect(pos(3).player1Id).toBe(newWinner);
    });
  });

  describe('resyncAdvancement', () => {
    it('re-places the winner into a wiped downstream slot (idempotent)', async () => {
      const tid = await se4();
      const m1 = (await positionLookup(tid))(1);
      const winner = must(m1.player1Id);
      await completeMatch(m1.id, winner);

      // Simulate a lost advancement.
      const finalId = (await positionLookup(tid))(3).id;
      await db
        .update(matches)
        .set({ player1Id: null })
        .where(eq(matches.id, finalId));

      const res = await resyncAdvancement(m1.id);
      expect(res.success).toBe(true);
      expect((await positionLookup(tid))(3).player1Id).toBe(winner);
    });

    it('rejects an unknown or unfinished match', async () => {
      const tid = await se4();
      const m1 = (await positionLookup(tid))(1);

      expect(await resyncAdvancement(MISSING_ID)).toEqual({
        success: false,
        error: 'Матч не найден',
      });
      expect(await resyncAdvancement(m1.id)).toEqual({
        success: false,
        error: 'Матч не завершён',
      });
    });
  });
});
