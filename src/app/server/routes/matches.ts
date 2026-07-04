import { Hono } from 'hono';
import { z } from 'zod';
import type { Api } from 'grammy';
import type { UUID } from 'crypto';

import {
  getMatch,
  reportResult,
  confirmResult,
  disputeResult,
} from '@/services/matchService.js';
import {
  getTournament,
  getUserParticipation,
  isTournamentVisibleTo,
} from '@/services/tournamentService.js';
import {
  notifyResultPending,
  notifyResultConfirmed,
  notifyResultDisputed,
} from '@/services/notificationService.js';
import { requireUser } from '@/admin/server/middleware.js';

import { validateParam, validateJson } from './_shared.js';

const paramId = z.object({ id: z.uuid() });
const scoreBody = z.object({
  player1Score: z.number().int().min(0),
  player2Score: z.number().int().min(0),
});

const SCORE_MESSAGES = {
  player1Score: 'Некорректный счёт',
  player2Score: 'Некорректный счёт',
} as const;

function isPlayer(
  match: { player1Id: UUID | null; player2Id: UUID | null },
  userId: UUID,
): boolean {
  return match.player1Id === userId || match.player2Id === userId;
}

export function createAppMatchesRouter(botApi: Api) {
  const router = new Hono();

  router.use('/*', requireUser);

  // Доступ к карточке матча: игрок матча ИЛИ турнир матча видим игроку.
  router.get('/:id', validateParam(paramId), async (c) => {
    const { id } = c.req.valid('param') as { id: UUID };
    const userId = c.get('appUser').id;

    const match = await getMatch(id);
    if (!match) return c.json({ error: 'Матч не найден' }, 404);

    if (!isPlayer(match, userId)) {
      const tournament = await getTournament(match.tournamentId);
      const participation = tournament
        ? await getUserParticipation(tournament.id, userId)
        : undefined;
      const visible =
        tournament != null &&
        isTournamentVisibleTo(tournament, {
          isAdmin: false,
          isReferee: false,
          isParticipant:
            participation != null && participation.status !== 'cancelled',
          isCreator: tournament.createdBy === userId,
        });
      if (!visible) return c.json({ error: 'Матч не найден' }, 404);
    }

    return c.json({ data: match });
  });

  // Внести результат — только участник матча.
  router.post(
    '/:id/report',
    validateParam(paramId),
    validateJson(scoreBody, SCORE_MESSAGES),
    async (c) => {
      const { id } = c.req.valid('param') as { id: UUID };
      const userId = c.get('appUser').id;
      const { player1Score, player2Score } = c.req.valid('json');

      const match = await getMatch(id);
      if (!match) return c.json({ error: 'Матч не найден' }, 404);
      if (!isPlayer(match, userId)) {
        return c.json({ error: 'Вы не являетесь участником этого матча' }, 403);
      }

      const result = await reportResult(id, userId, player1Score, player2Score);
      if (!result.success) return c.json({ error: result.error }, 400);

      try {
        const updated = await getMatch(id);
        if (updated) await notifyResultPending(botApi, updated, userId);
      } catch (error) {
        console.error('Failed to send result pending notification:', error);
      }

      return c.json({ data: { ok: true } });
    },
  );

  // Подтвердить результат — только участник; самоподтверждение блокирует сервис (S2-10).
  router.post('/:id/confirm', validateParam(paramId), async (c) => {
    const { id } = c.req.valid('param') as { id: UUID };
    const userId = c.get('appUser').id;

    const match = await getMatch(id);
    if (!match) return c.json({ error: 'Матч не найден' }, 404);
    if (!isPlayer(match, userId)) {
      return c.json({ error: 'Вы не являетесь участником этого матча' }, 403);
    }

    const result = await confirmResult(id, userId, botApi);
    if (!result.success) return c.json({ error: result.error }, 400);

    try {
      const updated = await getMatch(id);
      if (updated) await notifyResultConfirmed(botApi, updated);
    } catch (error) {
      console.error('Failed to send result confirmed notification:', error);
    }

    return c.json({ data: { ok: true } });
  });

  // Оспорить результат — только участник.
  router.post('/:id/dispute', validateParam(paramId), async (c) => {
    const { id } = c.req.valid('param') as { id: UUID };
    const userId = c.get('appUser').id;

    const match = await getMatch(id);
    if (!match) return c.json({ error: 'Матч не найден' }, 404);
    if (!isPlayer(match, userId)) {
      return c.json({ error: 'Вы не являетесь участником этого матча' }, 403);
    }

    const result = await disputeResult(id, userId);
    if (!result.success) return c.json({ error: result.error }, 400);

    try {
      const updated = await getMatch(id);
      if (updated) await notifyResultDisputed(botApi, updated, userId);
    } catch (error) {
      console.error('Failed to send result disputed notification:', error);
    }

    return c.json({ data: { ok: true } });
  });

  return router;
}
