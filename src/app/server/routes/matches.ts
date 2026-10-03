import { Hono } from 'hono';
import { z } from 'zod';
import type { Api } from 'grammy';
import type { UUID } from 'crypto';

import type { MatchFrame } from '@/services/matchService.js';
import {
  getMatch,
  getMatchFrames,
  reportResult,
  reportResultFromFrames,
  saveMatchFrame,
  deleteLastMatchFrame,
  confirmResult,
  disputeResult,
} from '@/services/matchService.js';
import { markPlayerReady } from '@/services/matchCallService.js';
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

const frameSchema = z.object({
  player1Points: z.number().int().min(0),
  player2Points: z.number().int().min(0),
  player1Break: z.number().int().min(0).nullable().optional(),
  player2Break: z.number().int().min(0).nullable().optional(),
});

const framesBody = z.object({
  frames: z.array(frameSchema).min(1),
});

const FRAMES_MESSAGES = { frames: 'Некорректный счёт по фреймам' } as const;

const FRAME_MESSAGES = {
  player1Points: 'Некорректный счёт',
  player2Points: 'Некорректный счёт',
  player1Break: 'Некорректный брейк',
  player2Break: 'Некорректный брейк',
} as const;

const paramIdFrame = z.object({
  id: z.uuid(),
  frameNumber: z.coerce.number().int().min(1),
});

/** API shape of a frame row (the same for GET and the draft edits). */
function toFrameDto(f: MatchFrame) {
  return {
    frameNumber: f.frameNumber,
    player1Points: f.player1Points,
    player2Points: f.player2Points,
    player1Break: f.player1Break,
    player2Break: f.player2Break,
  };
}

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

  // Разбивка по фреймам (снукер) — участник матча ИЛИ видимый турнир.
  router.get('/:id/frames', validateParam(paramId), async (c) => {
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

    const frames = await getMatchFrames(id);
    return c.json({ data: frames.map(toFrameDto) });
  });

  // Сохранить один фрейм по ходу матча (снукер, черновик) — только участник.
  router.put(
    '/:id/frames/:frameNumber',
    validateParam(paramIdFrame),
    validateJson(frameSchema, FRAME_MESSAGES),
    async (c) => {
      const { id, frameNumber } = c.req.valid('param') as {
        id: UUID;
        frameNumber: number;
      };
      const userId = c.get('appUser').id;
      const f = c.req.valid('json');

      const match = await getMatch(id);
      if (!match) return c.json({ error: 'Матч не найден' }, 404);
      if (!isPlayer(match, userId)) {
        return c.json({ error: 'Вы не являетесь участником этого матча' }, 403);
      }

      const result = await saveMatchFrame(id, frameNumber, {
        player1Points: f.player1Points,
        player2Points: f.player2Points,
        player1Break: f.player1Break ?? null,
        player2Break: f.player2Break ?? null,
      });
      if (!result.success) return c.json({ error: result.error }, 400);
      return c.json({ data: result.frames.map(toFrameDto) });
    },
  );

  // Удалить последний сохранённый фрейм — только участник.
  router.delete('/:id/frames/last', validateParam(paramId), async (c) => {
    const { id } = c.req.valid('param') as { id: UUID };
    const userId = c.get('appUser').id;

    const match = await getMatch(id);
    if (!match) return c.json({ error: 'Матч не найден' }, 404);
    if (!isPlayer(match, userId)) {
      return c.json({ error: 'Вы не являетесь участником этого матча' }, 403);
    }

    const result = await deleteLastMatchFrame(id);
    if (!result.success) return c.json({ error: result.error }, 400);
    return c.json({ data: result.frames.map(toFrameDto) });
  });

  // «Я у стола» — участник вызванного к столу матча подтверждает явку; второй
  // подтвердивший начинает матч. Состояние вызова проверяет сервис.
  router.post('/:id/ready', validateParam(paramId), async (c) => {
    const { id } = c.req.valid('param') as { id: UUID };
    const userId = c.get('appUser').id;

    const match = await getMatch(id);
    if (!match) return c.json({ error: 'Матч не найден' }, 404);
    if (!isPlayer(match, userId)) {
      return c.json({ error: 'Вы не являетесь участником этого матча' }, 403);
    }

    const result = await markPlayerReady(id, userId, botApi);
    if (!result.success) return c.json({ error: result.error }, 400);

    return c.json({ data: { started: result.started } });
  });

  // Внести результат по фреймам (снукер) — только участник матча.
  router.post(
    '/:id/report-frames',
    validateParam(paramId),
    validateJson(framesBody, FRAMES_MESSAGES),
    async (c) => {
      const { id } = c.req.valid('param') as { id: UUID };
      const userId = c.get('appUser').id;
      const { frames } = c.req.valid('json');

      const match = await getMatch(id);
      if (!match) return c.json({ error: 'Матч не найден' }, 404);
      if (!isPlayer(match, userId)) {
        return c.json({ error: 'Вы не являетесь участником этого матча' }, 403);
      }

      const result = await reportResultFromFrames(
        id,
        userId,
        frames.map((f) => ({
          player1Points: f.player1Points,
          player2Points: f.player2Points,
          player1Break: f.player1Break ?? null,
          player2Break: f.player2Break ?? null,
        })),
      );
      if (!result.success) return c.json({ error: result.error }, 400);

      try {
        const updated = await getMatch(id);
        if (updated) {
          const savedFrames = await getMatchFrames(id);
          await notifyResultPending(botApi, updated, userId, savedFrames);
        }
      } catch (error) {
        console.error('Failed to send result pending notification:', error);
      }

      return c.json({ data: { ok: true } });
    },
  );

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
