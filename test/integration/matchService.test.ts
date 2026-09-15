import type { UUID } from 'crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { eq } from 'drizzle-orm';

import type { Match } from '@/bot/@types/match.js';
import { db } from '@/db/db.js';
import { users } from '@/db/schema.js';
import { getMatch } from '@/services/matchService.js';
import {
  reportResult,
  reportResultFromFrames,
  getMatchFrames,
  confirmResult,
  disputeResult,
  setTechnicalResult,
  startMatch,
  getTournamentMatches,
} from '@/services/matchService.js';
import type { FrameInput } from '@/services/matchService.js';

import {
  createAdminUser,
  createConfirmedParticipant,
  createMatchesForTournament,
  createTournament,
  createTournamentWithParticipants,
  createUser,
  completeMatch,
  playAllReady,
} from '../helpers/factories.js';
import { must } from '../helpers/must.js';
import { truncateAll } from '../helpers/truncate.js';

const MISSING_ID = '00000000-0000-0000-0000-000000000000' as UUID;

/** A fresh single-match 2-player single-elimination tournament. */
async function freshMatch(): Promise<{ match: Match; p1: UUID; p2: UUID }> {
  const { tournament, participantIds } = await createTournamentWithParticipants(
    2,
    'single_elimination',
  );
  const all = await createMatchesForTournament(
    tournament.id,
    'single_elimination',
  );
  // Seeds 1 and 2 map to player1 / player2 of the only match.
  return {
    match: must(all[0], 'match'),
    p1: must(participantIds[0], 'seed1'),
    p2: must(participantIds[1], 'seed2'),
  };
}

describe('matchService lifecycle', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  describe('reportResult', () => {
    it('moves the match to pending_confirmation with the winner', async () => {
      const { match, p1 } = await freshMatch();
      const res = await reportResult(match.id, p1, 3, 0);
      expect(res.success).toBe(true);

      const after = await getMatch(match.id);
      expect(after?.status).toBe('pending_confirmation');
      expect(after?.winnerId).toBe(p1);
      expect(after?.reportedBy).toBe(p1);
      expect(after?.player1Score).toBe(3);
      expect(after?.player2Score).toBe(0);
    });

    it('rejects an unknown match', async () => {
      const res = await reportResult(MISSING_ID, MISSING_ID, 3, 0);
      expect(res).toEqual({ success: false, error: 'Матч не найден' });
    });

    it('rejects an already-completed match', async () => {
      const { match, p1 } = await freshMatch();
      await completeMatch(match.id, p1);
      const res = await reportResult(match.id, p1, 3, 0);
      expect(res).toEqual({ success: false, error: 'Матч уже завершён' });
    });

    it('rejects a reporter who is not a participant', async () => {
      const { match } = await freshMatch();
      const stranger = await createUser();
      const res = await reportResult(match.id, stranger.id, 3, 0);
      expect(res).toEqual({
        success: false,
        error: 'Вы не являетесь участником этого матча',
      });
    });

    it('rejects a score where neither player reached winScore', async () => {
      const { match, p1 } = await freshMatch();
      const res = await reportResult(match.id, p1, 2, 1);
      expect(res).toEqual({
        success: false,
        error: 'Один из игроков должен набрать 3 побед',
      });
    });

    it('rejects a score where both players reached winScore', async () => {
      const { match, p1 } = await freshMatch();
      const res = await reportResult(match.id, p1, 3, 3);
      expect(res).toEqual({
        success: false,
        error: 'Оба игрока не могут выиграть',
      });
    });
  });

  describe('confirmResult', () => {
    it('completes the match and records the confirmer', async () => {
      const { match, p1, p2 } = await freshMatch();
      await reportResult(match.id, p1, 3, 0);
      const res = await confirmResult(match.id, p2);
      expect(res.success).toBe(true);

      const after = await getMatch(match.id);
      expect(after?.status).toBe('completed');
      expect(after?.confirmedBy).toBe(p2);
      expect(after?.completedAt).not.toBeNull();
    });

    it('rejects an unknown match', async () => {
      const res = await confirmResult(MISSING_ID, MISSING_ID);
      expect(res).toEqual({ success: false, error: 'Матч не найден' });
    });

    it('rejects a match that is not pending confirmation', async () => {
      const { match, p2 } = await freshMatch();
      const res = await confirmResult(match.id, p2);
      expect(res).toEqual({
        success: false,
        error: 'Матч не ожидает подтверждения',
      });
    });

    it('rejects a confirmer who is not a participant', async () => {
      const { match, p1 } = await freshMatch();
      await reportResult(match.id, p1, 3, 0);
      const stranger = await createUser();
      const res = await confirmResult(match.id, stranger.id);
      expect(res).toEqual({
        success: false,
        error: 'Вы не являетесь участником этого матча',
      });
    });

    it('rejects the reporter confirming their own report (S2-10)', async () => {
      const { match, p1 } = await freshMatch();
      await reportResult(match.id, p1, 3, 0);
      const res = await confirmResult(match.id, p1);
      expect(res).toEqual({
        success: false,
        error: 'Нельзя подтверждать собственный отчёт',
      });
    });
  });

  describe('disputeResult', () => {
    it('reverts a pending match back to in_progress and clears the report', async () => {
      const { match, p1, p2 } = await freshMatch();
      await reportResult(match.id, p1, 3, 0);
      const res = await disputeResult(match.id, p2);
      expect(res.success).toBe(true);

      const after = await getMatch(match.id);
      expect(after?.status).toBe('in_progress');
      expect(after?.winnerId).toBeNull();
      expect(after?.reportedBy).toBeNull();
      expect(after?.player1Score).toBeNull();
      expect(after?.player2Score).toBeNull();
    });

    it('rejects a match that is not pending confirmation', async () => {
      const { match, p1 } = await freshMatch();
      const res = await disputeResult(match.id, p1);
      expect(res).toEqual({
        success: false,
        error: 'Матч не ожидает подтверждения',
      });
    });

    it('rejects a user who is not a participant', async () => {
      const { match, p1 } = await freshMatch();
      await reportResult(match.id, p1, 3, 0);
      const stranger = await createUser();
      const res = await disputeResult(match.id, stranger.id);
      expect(res).toEqual({
        success: false,
        error: 'Вы не являетесь участником этого матча',
      });
    });
  });

  describe('setTechnicalResult', () => {
    it('completes the match technically with a winScore-0 line', async () => {
      const { match, p1 } = await freshMatch();
      const admin = await createAdminUser();
      const res = await setTechnicalResult(match.id, p1, 'неявка', admin.id);
      expect(res.success).toBe(true);

      const after = await getMatch(match.id);
      expect(after?.status).toBe('completed');
      expect(after?.winnerId).toBe(p1);
      expect(after?.isTechnicalResult).toBe(true);
      expect(after?.technicalReason).toBe('неявка');
      expect(after?.player1Score).toBe(3);
      expect(after?.player2Score).toBe(0);
    });

    it('rejects an already-completed match', async () => {
      const { match, p1 } = await freshMatch();
      await completeMatch(match.id, p1);
      const res = await setTechnicalResult(match.id, p1, 'неявка', MISSING_ID);
      expect(res).toEqual({
        success: false,
        error: 'Матч уже завершён или отменён',
      });
    });

    it('rejects a winner who is not a participant', async () => {
      const { match } = await freshMatch();
      const stranger = await createUser();
      const res = await setTechnicalResult(
        match.id,
        stranger.id,
        'неявка',
        MISSING_ID,
      );
      expect(res).toEqual({
        success: false,
        error: 'Победитель должен быть участником матча',
      });
    });
  });

  describe('reportResultFromFrames (snooker)', () => {
    // Default winScore is 3 → a valid report needs a 3-frame decision.
    const sweep: FrameInput[] = [
      { player1Points: 80, player2Points: 1 },
      { player1Points: 70, player2Points: 2 },
      { player1Points: 60, player2Points: 3 },
    ];

    async function startedMatch() {
      const m = await freshMatch();
      await startMatch(m.match.id);
      return m;
    }

    it('writes frame rows + recomputed aggregate + pending_confirmation', async () => {
      const { match, p1 } = await startedMatch();
      const res = await reportResultFromFrames(match.id, p1, [
        { player1Points: 74, player2Points: 12 },
        { player1Points: 8, player2Points: 66 },
        { player1Points: 90, player2Points: 5 },
        { player1Points: 55, player2Points: 40 },
      ]);
      expect(res.success).toBe(true);

      const after = await getMatch(match.id);
      expect(after?.status).toBe('pending_confirmation');
      expect(after?.winnerId).toBe(p1);
      expect(after?.player1Score).toBe(3);
      expect(after?.player2Score).toBe(1);

      const frames = await getMatchFrames(match.id);
      expect(
        frames.map((f) => [f.frameNumber, f.player1Points, f.player2Points]),
      ).toEqual([
        [1, 74, 12],
        [2, 8, 66],
        [3, 90, 5],
        [4, 55, 40],
      ]);
    });

    it('accepts a report over a scheduled (not yet started) match', async () => {
      // The player client reports from scheduled too — parity with reportResult.
      const { match, p1 } = await freshMatch(); // still scheduled
      const res = await reportResultFromFrames(match.id, p1, sweep);
      expect(res.success).toBe(true);
      expect((await getMatch(match.id))?.status).toBe('pending_confirmation');
    });

    it('rejects a report over an already-completed match (guard)', async () => {
      const { match, p1, p2 } = await startedMatch();
      await reportResultFromFrames(match.id, p1, sweep);
      await confirmResult(match.id, p2); // → completed
      const res = await reportResultFromFrames(match.id, p1, sweep);
      expect(res.success).toBe(false);
    });

    it('rejects an invalid frame breakdown before touching the DB', async () => {
      const { match, p1 } = await startedMatch();
      const res = await reportResultFromFrames(match.id, p1, [
        { player1Points: 74, player2Points: 12 },
        { player1Points: 8, player2Points: 66 },
      ]);
      expect(res).toEqual({
        success: false,
        error: 'Один из игроков должен выиграть 3 фреймов',
      });
      expect(await getMatchFrames(match.id)).toHaveLength(0);
    });

    it('confirmResult completes the match and keeps the frames', async () => {
      const { match, p1, p2 } = await startedMatch();
      await reportResultFromFrames(match.id, p1, sweep);
      const res = await confirmResult(match.id, p2);
      expect(res.success).toBe(true);

      const after = await getMatch(match.id);
      expect(after?.status).toBe('completed');
      expect(await getMatchFrames(match.id)).toHaveLength(3);
    });

    it('disputeResult clears the aggregate AND the frame rows', async () => {
      const { match, p1, p2 } = await startedMatch();
      await reportResultFromFrames(match.id, p1, sweep);
      const res = await disputeResult(match.id, p2);
      expect(res.success).toBe(true);

      const after = await getMatch(match.id);
      expect(after?.status).toBe('in_progress');
      expect(after?.player1Score).toBeNull();
      expect(after?.player2Score).toBeNull();
      expect(await getMatchFrames(match.id)).toHaveLength(0);
    });

    it('persists per-frame breaks (snooker), null where unset', async () => {
      const { match, p1 } = await startedMatch();
      await reportResultFromFrames(match.id, p1, [
        { player1Points: 80, player2Points: 1, player1Break: 80 },
        { player1Points: 70, player2Points: 2, player1Break: 54 },
        { player1Points: 60, player2Points: 3 },
      ]);
      const frames = await getMatchFrames(match.id);
      expect(frames[0]?.player1Break).toBe(80);
      expect(frames[1]?.player1Break).toBe(54);
      expect(frames[0]?.player2Break).toBeNull();
      expect(frames[2]?.player1Break).toBeNull();
    });
  });

  describe('startMatch', () => {
    it('moves a scheduled match to in_progress', async () => {
      const { match } = await freshMatch();
      const res = await startMatch(match.id);
      expect(res.success).toBe(true);
      expect(res.match?.status).toBe('in_progress');
      expect(res.match?.startedAt).not.toBeNull();
    });

    it('fails for an unknown match', async () => {
      const res = await startMatch(MISSING_ID);
      expect(res.success).toBe(false);
    });

    it('rejects an already in-progress match', async () => {
      const { match } = await freshMatch();
      await startMatch(match.id);
      const res = await startMatch(match.id);
      expect(res).toEqual({
        success: false,
        error: 'Матч можно начать только из статуса «Запланирован»',
      });
    });

    it('rejects a completed match without touching its result', async () => {
      const { match, p1 } = await freshMatch();
      await completeMatch(match.id, p1);
      const before = await getMatch(match.id);

      const res = await startMatch(match.id);
      expect(res).toEqual({
        success: false,
        error: 'Матч можно начать только из статуса «Запланирован»',
      });

      const after = await getMatch(match.id);
      expect(after?.status).toBe('completed');
      expect(after?.winnerId).toBe(before?.winnerId);
      expect(after?.player1Score).toBe(before?.player1Score);
      expect(after?.player2Score).toBe(before?.player2Score);
    });
  });

  // One person plays at one table at a time, so a match must not start while
  // either of its players is mid-game — in this or any other tournament.
  describe('startMatch: one match per player at a time', () => {
    /**
     * 3-player round robin: every player meets both others, so any two matches
     * of the set share exactly one player.
     */
    async function roundRobin(): Promise<{ all: Match[] }> {
      const { tournament } = await createTournamentWithParticipants(
        3,
        'round_robin',
      );
      const all = await createMatchesForTournament(tournament.id, 'round_robin');
      return { all };
    }

    /** Two matches sharing exactly one player, plus that shared player's id. */
    function overlappingPair(all: Match[]): {
      first: Match;
      second: Match;
      shared: UUID;
    } {
      const first = must(all[0], 'first match');
      const firstPlayers = [first.player1Id, first.player2Id];
      for (const candidate of all.slice(1)) {
        const shared = [candidate.player1Id, candidate.player2Id].find(
          (id) => id !== null && firstPlayers.includes(id),
        );
        if (shared) return { first, second: candidate, shared };
      }
      throw new Error('round robin produced no overlapping pair');
    }

    it('refuses to start a second match for a player already mid-game', async () => {
      const { all } = await roundRobin();
      const { first, second } = overlappingPair(all);

      expect((await startMatch(first.id)).success).toBe(true);

      const res = await startMatch(second.id);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/уже играет другой матч/);
    });

    it('leaves the refused match untouched', async () => {
      const { all } = await roundRobin();
      const { first, second } = overlappingPair(all);
      await startMatch(first.id);

      await startMatch(second.id);

      const after = await getMatch(second.id);
      expect(after?.status).toBe('scheduled');
      expect(after?.startedAt).toBeNull();
    });

    it('names the blocked player in the error', async () => {
      const { all } = await roundRobin();
      const { first, second, shared } = overlappingPair(all);
      await startMatch(first.id);

      const res = await startMatch(second.id);
      const blocked = await db.query.users.findFirst({
        where: eq(users.id, shared),
      });
      expect(res.error).toContain(blocked?.name ?? '');
    });

    it('blocks on a match running in a DIFFERENT tournament', async () => {
      const { all } = await roundRobin();
      // Take the player from the match actually started — the round-robin
      // generator's match order is not the seed order.
      const live = must(all[0], 'match');
      const shared = must(live.player1Id, 'shared player');
      expect((await startMatch(live.id)).success).toBe(true);

      // A second tournament the same person also plays in.
      const other = await createTournament({
        format: 'single_elimination',
        status: 'registration_open',
      });
      await createConfirmedParticipant(other.id, { userId: shared, seed: 1 });
      await createConfirmedParticipant(other.id, { seed: 2 });
      const otherMatches = await createMatchesForTournament(
        other.id,
        'single_elimination',
      );

      const res = await startMatch(must(otherMatches[0], 'match').id);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/уже играет другой матч/);
    });

    it('does NOT block on a match awaiting score confirmation', async () => {
      const { all } = await roundRobin();
      const { first, second } = overlappingPair(all);
      await startMatch(first.id);
      // Report without confirming: the game is physically over, the player is free.
      const reporter = must(first.player1Id, 'player1');
      expect((await reportResult(first.id, reporter, 0, 3)).success).toBe(true);
      expect((await getMatch(first.id))?.status).toBe('pending_confirmation');

      expect((await startMatch(second.id)).success).toBe(true);
    });

    it('lets the blocked match start once the blocker completes', async () => {
      const { all } = await roundRobin();
      const { first, second } = overlappingPair(all);
      await startMatch(first.id);
      expect((await startMatch(second.id)).success).toBe(false);

      await completeMatch(first.id, must(first.player1Id, 'player1'));

      const res = await startMatch(second.id);
      expect(res.success).toBe(true);
      expect(res.match?.status).toBe('in_progress');
    });

    it('lets two matches with no player in common run at once', async () => {
      const { tournament } = await createTournamentWithParticipants(
        4,
        'single_elimination',
      );
      const all = await createMatchesForTournament(
        tournament.id,
        'single_elimination',
      );
      const round1 = all.filter((m) => m.player1Id && m.player2Id);
      expect(round1).toHaveLength(2);

      for (const match of round1) {
        expect((await startMatch(match.id)).success).toBe(true);
      }
    });

    it('survives concurrent starts of two matches sharing a player', async () => {
      const { all } = await roundRobin();
      const { first, second } = overlappingPair(all);

      const results = await Promise.all([
        startMatch(first.id),
        startMatch(second.id),
      ]);

      expect(results.filter((r) => r.success)).toHaveLength(1);
      const statuses = await Promise.all([
        getMatch(first.id),
        getMatch(second.id),
      ]);
      expect(statuses.filter((m) => m?.status === 'in_progress')).toHaveLength(
        1,
      );
    });

    it('refuses to put a disputed match back into play against a live one', async () => {
      const { all } = await roundRobin();
      const { first, second } = overlappingPair(all);
      await startMatch(first.id);
      const reporter = must(first.player1Id, 'player1');
      const opponent = must(first.player2Id, 'player2');
      await reportResult(first.id, reporter, 0, 3);

      // The shared player is free to start their next match meanwhile...
      expect((await startMatch(second.id)).success).toBe(true);

      // ...so re-opening the first one would double-book them.
      const res = await disputeResult(first.id, opponent);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/Нельзя вернуть матч в игру/);
      expect((await getMatch(first.id))?.status).toBe('pending_confirmation');
    });
  });
});

describe('per-stage match length (M2-11)', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  /** 4-player SE: round 1 = semifinals, round 2 = the final. */
  async function stagedTournament() {
    const { tournament, participantIds } =
      await createTournamentWithParticipants(4, 'single_elimination', {
        winScore: 3,
        stageWinScores: { final: 5, semifinal: 4 },
      });
    const all = await createMatchesForTournament(
      tournament.id,
      'single_elimination',
    );
    return { tournament, participantIds, all };
  }

  it('materializes the stage length onto each match row', async () => {
    const { all } = await stagedTournament();

    const semis = all.filter((m) => m.round === 1);
    const final = must(
      all.find((m) => m.round === 2),
      'final',
    );

    expect(semis).toHaveLength(2);
    for (const s of semis) expect(s.winScore).toBe(4);
    expect(final.winScore).toBe(5);
  });

  it('validates a report against the match stage, not the tournament', async () => {
    const { all } = await stagedTournament();
    const semi = must(
      all.find((m) => m.round === 1),
      'semi',
    );
    const p1 = must(semi.player1Id, 'p1');

    // 3 is the tournament winScore, but this round is played to 4.
    const tooShort = await reportResult(semi.id, p1, 3, 1);
    expect(tooShort).toEqual({
      success: false,
      error: 'Один из игроков должен набрать 4 побед',
    });

    const ok = await reportResult(semi.id, p1, 4, 1);
    expect(ok.success).toBe(true);
  });

  it('uses the final length for a technical result in the final', async () => {
    const { all } = await stagedTournament();

    // Play both semifinals so the final has two players.
    for (const semi of all.filter((m) => m.round === 1)) {
      await completeMatch(semi.id, must(semi.player1Id, 'p1'));
    }

    const tournamentId = must(all[0], 'any match').tournamentId;
    const final = must(
      (await getTournamentMatches(tournamentId)).find((m) => m.round === 2),
      'final',
    );
    const winner = must(final.player1Id, 'finalist');

    const admin = await createAdminUser();
    const res = await setTechnicalResult(final.id, winner, 'неявка', admin.id);
    expect(res.success).toBe(true);

    const stored = must(await getMatch(final.id), 'stored final');
    expect(Math.max(stored.player1Score ?? 0, stored.player2Score ?? 0)).toBe(
      5,
    );
  });

  it('leaves matches of a tournament without overrides on the tournament length', async () => {
    const { tournament } = await createTournamentWithParticipants(
      4,
      'single_elimination',
      { winScore: 3 },
    );
    const all = await createMatchesForTournament(
      tournament.id,
      'single_elimination',
    );

    for (const m of all) expect(m.winScore).toBeNull();
  });

  it('drives a full staged bracket to completion', async () => {
    const { tournament } = await createTournamentWithParticipants(
      8,
      'single_elimination',
      { winScore: 3, stageWinScores: { final: 5, semifinal: 4 } },
    );
    await createMatchesForTournament(tournament.id, 'single_elimination');

    await playAllReady(tournament.id, 'single_elimination');
  });
});
