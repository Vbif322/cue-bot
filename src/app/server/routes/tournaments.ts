import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { UUID } from 'crypto';

import {
  getTournament,
  getTournaments,
  getTournamentByInviteCode,
  getConfirmedParticipants,
  getUserParticipation,
  isTournamentVisibleTo,
  registerParticipant,
  cancelRegistration,
  acceptInvitation,
  declineInvitation,
} from '@/services/tournamentService.js';
import type { TournamentReadModel } from '@/bot/@types/tournament.js';
import { getBracketReadModel } from '@/services/bracketReadService.js';
import { getGroupStandings } from '@/services/groupPhaseService.js';
import {
  APP_SESSION,
  requireUser,
  resolveUserFromCookie,
} from '@/admin/server/middleware.js';

import { validateParam, outcomeError } from './_shared.js';

const paramId = z.object({ id: z.uuid() });
const paramCode = z.object({ code: z.string().min(1).max(64) });

/**
 * Флаги видимости турнира для игрока. Для app-API `isAdmin`/`isReferee` ВСЕГДА
 * `false` — админ/судейские возможности живут в `/api/*`, даже если у
 * пользователя `role='admin'`.
 */
async function computeViewer(
  tournament: TournamentReadModel,
  userId: UUID | null,
): Promise<{ isParticipant: boolean; isCreator: boolean }> {
  if (!userId) return { isParticipant: false, isCreator: false };
  const participation = await getUserParticipation(tournament.id, userId);
  const isParticipant =
    participation != null && participation.status !== 'cancelled';
  return { isParticipant, isCreator: tournament.createdBy === userId };
}

function visibleTo(
  tournament: TournamentReadModel,
  viewer: { isParticipant: boolean; isCreator: boolean },
): boolean {
  return isTournamentVisibleTo(tournament, {
    isAdmin: false,
    isReferee: false,
    ...viewer,
  });
}

/**
 * Достаёт id пользователя из сессии без обязательности входа — для публичных GET,
 * где вход опционален и влияет только на видимость private-турниров. Опции те же,
 * что у requireUser (кука + Bearer): Mini App-сессия без куки должна видеть свои
 * private-турниры так же, как на защищённых эндпоинтах.
 */
async function optionalUserId(c: Context): Promise<UUID | null> {
  const user = await resolveUserFromCookie(c, APP_SESSION);
  return user?.id ?? null;
}

/**
 * Возвращает видимый пользователю турнир либо 404-ответ. Единая точка проверки
 * видимости для объектных GET (карточка и вложенные ресурсы).
 */
async function loadVisible(
  c: Context,
  id: UUID,
): Promise<
  | { tournament: TournamentReadModel; userId: UUID | null; error?: undefined }
  | { error: Response; tournament?: undefined; userId?: undefined }
> {
  const tournament = await getTournament(id);
  if (!tournament) {
    return { error: c.json({ error: 'Турнир не найден' }, 404) };
  }
  const userId = await optionalUserId(c);
  const viewer = await computeViewer(tournament, userId);
  if (!visibleTo(tournament, viewer)) {
    return { error: c.json({ error: 'Турнир не найден' }, 404) };
  }
  return { tournament, userId };
}

export function createAppTournamentsRouter() {
  const router = new Hono();

  // Публичная лента: только публичные, без черновиков.
  router.get('/', async (c) => {
    const list = await getTournaments({
      includesDrafts: false,
      includePrivate: false,
    });
    return c.json({ data: list });
  });

  // Публичная карточка по инвайт-коду (deep-link `join_<code>`): владение кодом
  // и есть авторизация — отдельная проверка видимости не нужна.
  router.get('/invites/:code', validateParam(paramCode), async (c) => {
    const { code } = c.req.valid('param');
    const tournament = await getTournamentByInviteCode(code);
    if (!tournament) return c.json({ error: 'Турнир не найден' }, 404);
    return c.json({ data: tournament });
  });

  // Регистрация по инвайт-коду.
  router.post(
    '/invites/:code/join',
    requireUser,
    validateParam(paramCode),
    async (c) => {
      const { code } = c.req.valid('param');
      const tournament = await getTournamentByInviteCode(code);
      if (!tournament) return c.json({ error: 'Турнир не найден' }, 404);

      const outcome = await registerParticipant(tournament.id, c.get('appUser').id, {
        desiredStatus: 'pending',
        requireOpen: true,
      });
      if (!outcome.ok) return outcomeError(c, outcome.reason);
      return c.json({ data: { status: outcome.status } });
    },
  );

  // Карточка турнира: невидим (чужой private) → 404, не раскрываем существование.
  router.get('/:id', validateParam(paramId), async (c) => {
    const { id } = c.req.valid('param') as { id: UUID };
    const loaded = await loadVisible(c, id);
    if (loaded.error) return loaded.error;

    const participation = loaded.userId
      ? await getUserParticipation(id, loaded.userId)
      : undefined;
    const viewer = await computeViewer(loaded.tournament, loaded.userId);

    return c.json({
      data: {
        tournament: loaded.tournament,
        isParticipant: viewer.isParticipant,
        isCreator: viewer.isCreator,
        participationStatus: participation?.status ?? null,
      },
    });
  });

  router.get('/:id/participants', validateParam(paramId), async (c) => {
    const { id } = c.req.valid('param') as { id: UUID };
    const loaded = await loadVisible(c, id);
    if (loaded.error) return loaded.error;

    return c.json({ data: await getConfirmedParticipants(id) });
  });

  router.get('/:id/bracket', validateParam(paramId), async (c) => {
    const { id } = c.req.valid('param') as { id: UUID };
    const loaded = await loadVisible(c, id);
    if (loaded.error) return loaded.error;

    const bracket = await getBracketReadModel(id);
    if (!bracket) return c.json({ error: 'Турнир не найден' }, 404);

    // playerMap — это Map, не сериализуется в JSON; отдаём как объект.
    const { playerMap, ...rest } = bracket;
    return c.json({ data: { ...rest, players: Object.fromEntries(playerMap) } });
  });

  router.get('/:id/standings', validateParam(paramId), async (c) => {
    const { id } = c.req.valid('param') as { id: UUID };
    const loaded = await loadVisible(c, id);
    if (loaded.error) return loaded.error;

    return c.json({ data: await getGroupStandings(id) });
  });

  router.post('/:id/register', requireUser, validateParam(paramId), async (c) => {
    const { id } = c.req.valid('param') as { id: UUID };
    const loaded = await loadVisible(c, id);
    if (loaded.error) return loaded.error;

    const outcome = await registerParticipant(id, c.get('appUser').id, {
      desiredStatus: 'pending',
      requireOpen: true,
    });
    if (!outcome.ok) return outcomeError(c, outcome.reason);
    return c.json({ data: { status: outcome.status } });
  });

  router.post('/:id/cancel', requireUser, validateParam(paramId), async (c) => {
    const { id } = c.req.valid('param') as { id: UUID };
    const outcome = await cancelRegistration(id, c.get('appUser').id);
    if (!outcome.ok) return outcomeError(c, outcome.reason);
    return c.json({ data: { ok: true } });
  });

  router.post(
    '/:id/invitation/accept',
    requireUser,
    validateParam(paramId),
    async (c) => {
      const { id } = c.req.valid('param') as { id: UUID };
      const outcome = await acceptInvitation(id, c.get('appUser').id);
      if (!outcome.ok) return outcomeError(c, outcome.reason);
      return c.json({ data: { ok: true } });
    },
  );

  router.post(
    '/:id/invitation/decline',
    requireUser,
    validateParam(paramId),
    async (c) => {
      const { id } = c.req.valid('param') as { id: UUID };
      const outcome = await declineInvitation(id, c.get('appUser').id);
      if (!outcome.ok) return outcomeError(c, outcome.reason);
      return c.json({ data: { ok: true } });
    },
  );

  return router;
}
