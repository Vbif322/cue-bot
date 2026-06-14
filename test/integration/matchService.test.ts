import type { UUID } from 'crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import type { Match } from '@/bot/@types/match.js';
import { getMatch } from '@/services/matchService.js';
import {
  reportResult,
  confirmResult,
  disputeResult,
  setTechnicalResult,
  startMatch,
} from '@/services/matchService.js';

import {
  createAdminUser,
  createMatchesForTournament,
  createTournamentWithParticipants,
  createUser,
  completeMatch,
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
  });
});
