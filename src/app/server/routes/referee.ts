import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { Api } from 'grammy';
import type { UUID } from 'crypto';

import {
  callMatchToTable,
  deleteLastMatchFrame,
  findMatchHoldingTable,
  getMatch,
  getMatchFrames,
  getQueuePlayersBusyElsewhere,
  getTournamentMatches,
  playerSlotName,
  recordRefereeResult,
  saveMatchFrame,
  setMatchQueue,
  setMatchSchedule,
  setMatchTable,
  setTechnicalResult,
  startMatch,
  winScoreForMatch,
} from '@/services/matchService.js';
import {
  extendCall,
  markParticipantPresent,
  markPlayerReady,
  noShowTechnicalLoss,
  postponeCalledMatch,
} from '@/services/matchCallService.js';
import {
  ACTIVE_MATCH_STATUSES,
  canManageTournamentAsUser,
  getAbsentParticipants,
  getRefereeAttention,
  getRefereeTournaments,
} from '@/services/refereeService.js';
import { getTournament } from '@/services/tournamentService.js';
import { getTournamentTables } from '@/services/tableService.js';
import {
  notifyMatchScheduleCleared,
  notifyMatchScheduled,
  notifyMatchStart,
} from '@/services/notificationService.js';
import type { MatchWithPlayers } from '@/bot/@types/match.js';
import type { TournamentReadModel } from '@/bot/@types/tournament.js';
import {
  idFrameNumberParam,
  idParam,
  idUserIdParam,
  tournamentIdParam,
} from '@/admin/server/routes/_shared.js';
import { requireUser } from '@/admin/server/middleware.js';

import { validateJson, validateParam } from './_shared.js';
import {
  FRAME_MESSAGES,
  FRAMES_MESSAGES,
  frameSchema,
  toFrameDto,
} from './matches.js';

/**
 * Судейский пульт (`/api/app/referee/*`) — раздел сайта игрока. Доступ: админ
 * или судья турнира (`tournament_referees`), проверяется на КАЖДЫЙ запрос.
 * Турнир всегда берётся из строки матча, а не из запроса клиента. Мутации
 * требуют идущий турнир и запрещены судье в собственном матче.
 */

const slotBody = z.object({ slot: z.literal([1, 2]) });
const absentSlotBody = z.object({ absentSlot: z.literal([1, 2]) });
const technicalBody = z.object({
  winnerSlot: z.literal([1, 2]),
  reason: z.string().trim().min(1).max(200).optional(),
});
const scoreBody = z.object({
  player1Score: z.number().int().min(0),
  player2Score: z.number().int().min(0),
});
const framesBody = z.object({ frames: z.array(frameSchema).min(1) });
const tableBody = z.object({
  tableId: z.uuid().nullable(),
  force: z.boolean().optional(),
});
const callBody = z.object({ tableId: z.uuid() });
const scheduleBody = z.object({ scheduledAt: z.iso.datetime().nullable() });
const queueBody = z.object({
  matchIds: z.array(z.uuid()).min(1),
  expectedMatchIds: z.array(z.uuid()).min(1),
});

const SCORE_MESSAGES = {
  player1Score: 'Некорректный счёт',
  player2Score: 'Некорректный счёт',
} as const;

/** How many finished matches the tournament board carries (recent results). */
const RECENT_COMPLETED = 10;

/** Default reason of a referee's technical result. */
const DEFAULT_TECHNICAL_REASON = 'Решение судьи';

/** The tournament fields the referee screens need. */
function toTournamentDto(t: TournamentReadModel) {
  return {
    id: t.id,
    name: t.name,
    status: t.status,
    format: t.format,
    discipline: t.discipline,
    scheduleMode: t.scheduleMode,
    winScore: t.winScore,
  };
}

type Managed<T> = T | { error: Response };

/** Admin or referee of `tournamentId`; for mutations — a running tournament. */
async function loadManagedTournament(
  c: Context,
  tournamentId: UUID,
  mutate: boolean,
): Promise<Managed<{ tournament: TournamentReadModel }>> {
  const tournament = await getTournament(tournamentId);
  if (!tournament) {
    return { error: c.json({ error: 'Турнир не найден' }, 404) };
  }
  if (!(await canManageTournamentAsUser(c.get('appUser'), tournament.id))) {
    return { error: c.json({ error: 'Недостаточно прав' }, 403) };
  }
  if (mutate && tournament.status !== 'in_progress') {
    return { error: c.json({ error: 'Турнир не идёт' }, 409) };
  }
  return { tournament };
}

/**
 * Match + its tournament, when the user may manage that tournament. For
 * mutations also: the tournament is running. A referee may decide their own
 * match — small clubs often have one referee who also plays.
 */
async function loadManagedMatch(
  c: Context,
  matchId: UUID,
  mutate: boolean,
): Promise<
  Managed<{ match: MatchWithPlayers; tournament: TournamentReadModel }>
> {
  const match = await getMatch(matchId);
  if (!match) return { error: c.json({ error: 'Матч не найден' }, 404) };

  const loaded = await loadManagedTournament(c, match.tournamentId, mutate);
  if ('error' in loaded) return loaded;
  return { match, tournament: loaded.tournament };
}

function slotPlayer(match: MatchWithPlayers, slot: 1 | 2): UUID | null {
  return slot === 1 ? match.player1Id : match.player2Id;
}

function isActive(match: MatchWithPlayers): boolean {
  return (ACTIVE_MATCH_STATUSES as readonly string[]).includes(match.status);
}

const OK = { data: { ok: true } } as const;

export function createAppRefereeRouter(botApi: Api) {
  const router = new Hono();

  router.use('/*', requireUser);

  // Главная пульта: турниры судьи со счётчиками + «Требует внимания».
  // Пустой список турниров = пользователь не судья (фронт прячет пункт меню).
  router.get('/tournaments', async (c) => {
    const user = c.get('appUser');
    const now = new Date();
    const [tournaments, attention] = await Promise.all([
      getRefereeTournaments(user, now),
      getRefereeAttention(user, now),
    ]);

    const names = new Map(tournaments.map((t) => [t.id, t.name]));
    const items = await Promise.all(
      attention.map(async (item) => ({
        reason: item.reason,
        tournamentName: names.get(item.tournamentId) ?? '',
        match: await getMatch(item.matchId),
      })),
    );

    return c.json({
      data: {
        tournaments,
        attention: items.filter((i) => i.match !== null),
      },
    });
  });

  // Доска турнира — всё для экранов «Столы/Очередь/Матчи» одним запросом
  // (его поллит фронт): незавершённые матчи + последние результаты, столы,
  // отсутствующие игроки и кто из очереди играет в другом турнире.
  router.get(
    '/tournaments/:tournamentId/board',
    validateParam(tournamentIdParam),
    async (c) => {
      const { tournamentId } = c.req.valid('param');
      const loaded = await loadManagedTournament(c, tournamentId, false);
      if ('error' in loaded) return loaded.error;

      const [all, tables, absent, busyElsewhere] = await Promise.all([
        getTournamentMatches(tournamentId),
        getTournamentTables(tournamentId),
        getAbsentParticipants(tournamentId),
        getQueuePlayersBusyElsewhere(tournamentId),
      ]);

      const recent = all
        .filter((m) => m.status === 'completed' && m.completedAt !== null)
        .sort(
          (a, b) =>
            (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0),
        )
        .slice(0, RECENT_COMPLETED);

      return c.json({
        data: {
          tournament: toTournamentDto(loaded.tournament),
          matches: all.filter(isActive),
          recent,
          tables: tables.map((t) => ({ id: t.id, name: t.name })),
          absent,
          busyElsewhere,
        },
      });
    },
  );

  // Порядок очереди: полный упорядоченный список ожидающих матчей.
  router.put(
    '/tournaments/:tournamentId/queue',
    validateParam(tournamentIdParam),
    validateJson(queueBody, {
      matchIds: 'Некорректный порядок очереди',
      expectedMatchIds: 'Некорректный порядок очереди',
    }),
    async (c) => {
      const { tournamentId } = c.req.valid('param');
      const loaded = await loadManagedTournament(c, tournamentId, true);
      if ('error' in loaded) return loaded.error;

      const { matchIds, expectedMatchIds } = c.req.valid('json');
      const result = await setMatchQueue(
        tournamentId,
        matchIds as UUID[],
        expectedMatchIds as UUID[],
      );
      if (!result.success) return c.json({ error: result.error }, 400);
      return c.json(OK);
    },
  );

  // Игрок, отмеченный отсутствующим, снова на месте — очередь его подхватит.
  router.post(
    '/tournaments/:id/participants/:userId/present',
    validateParam(idUserIdParam),
    async (c) => {
      const { id: tournamentId, userId } = c.req.valid('param');
      const loaded = await loadManagedTournament(c, tournamentId, true);
      if ('error' in loaded) return loaded.error;

      const result = await markParticipantPresent(tournamentId, userId, botApi);
      if (!result.success) return c.json({ error: result.error }, 400);
      return c.json({ data: { wasAbsent: result.wasAbsent } });
    },
  );

  // Карточка матча для судьи: матч, длина, фреймы и столы турнира.
  router.get('/matches/:id', validateParam(idParam), async (c) => {
    const { id } = c.req.valid('param');
    const loaded = await loadManagedMatch(c, id, false);
    if ('error' in loaded) return loaded.error;
    const { match, tournament } = loaded;

    const [frames, tables] = await Promise.all([
      getMatchFrames(id),
      getTournamentTables(tournament.id),
    ]);

    return c.json({
      data: {
        match,
        tournament: toTournamentDto(tournament),
        winScore: winScoreForMatch(match, tournament),
        frames: frames.map(toFrameDto),
        tables: tables.map((t) => ({ id: t.id, name: t.name })),
      },
    });
  });

  // Начать матч (в т.ч. вызванный, без подтверждения явки игроками).
  router.post('/matches/:id/start', validateParam(idParam), async (c) => {
    const { id } = c.req.valid('param');
    const loaded = await loadManagedMatch(c, id, true);
    if ('error' in loaded) return loaded.error;

    const result = await startMatch(id);
    if (!result.success) return c.json({ error: result.error }, 400);

    try {
      const started = await getMatch(id);
      if (started) {
        await notifyMatchStart(
          botApi,
          started,
          loaded.tournament.name,
          c.get('appUser').id,
        );
      }
    } catch (err) {
      console.error(`Failed to notify match start for ${id}:`, err);
    }

    return c.json(OK);
  });

  // Отметить явку игрока за него (у стола без бота). Вторая отметка начинает матч.
  router.post(
    '/matches/:id/ready',
    validateParam(idParam),
    validateJson(slotBody, { slot: 'Некорректный игрок' }),
    async (c) => {
      const { id } = c.req.valid('param');
      const loaded = await loadManagedMatch(c, id, true);
      if ('error' in loaded) return loaded.error;

      const playerId = slotPlayer(loaded.match, c.req.valid('json').slot);
      if (!playerId) return c.json({ error: 'В матче нет этого игрока' }, 400);

      const result = await markPlayerReady(id, playerId, botApi);
      if (!result.success) return c.json({ error: result.error }, 400);
      return c.json({ data: { started: result.started } });
    },
  );

  // «+5 мин» к ожиданию вызванных игроков.
  router.post('/matches/:id/extend-call', validateParam(idParam), async (c) => {
    const { id } = c.req.valid('param');
    const loaded = await loadManagedMatch(c, id, true);
    if ('error' in loaded) return loaded.error;

    const result = await extendCall(id);
    if (!result.success) return c.json({ error: result.error }, 400);
    return c.json(OK);
  });

  // Отложить вызванный матч: стол уходит следующему, неявившиеся — «отсутствуют».
  router.post('/matches/:id/postpone', validateParam(idParam), async (c) => {
    const { id } = c.req.valid('param');
    const loaded = await loadManagedMatch(c, id, true);
    if ('error' in loaded) return loaded.error;

    const result = await postponeCalledMatch(id, botApi);
    if (!result.success) return c.json({ error: result.error }, 400);
    return c.json(OK);
  });

  // Неявка: техническое поражение игроку в слоте absentSlot.
  router.post(
    '/matches/:id/no-show',
    validateParam(idParam),
    validateJson(absentSlotBody, { absentSlot: 'Некорректный игрок' }),
    async (c) => {
      const { id } = c.req.valid('param');
      const loaded = await loadManagedMatch(c, id, true);
      if ('error' in loaded) return loaded.error;

      const { absentSlot } = c.req.valid('json');
      const result = await noShowTechnicalLoss(
        id,
        absentSlot,
        c.get('appUser').id,
        botApi,
      );
      if (!result.success) return c.json({ error: result.error }, 400);
      return c.json(OK);
    },
  );

  // Технический результат: победитель по слоту, причина — по желанию.
  router.post(
    '/matches/:id/technical',
    validateParam(idParam),
    validateJson(technicalBody, {
      winnerSlot: 'Выберите победителя',
      reason: 'Причина — до 200 символов',
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const loaded = await loadManagedMatch(c, id, true);
      if ('error' in loaded) return loaded.error;

      const { winnerSlot, reason } = c.req.valid('json');
      const winnerId = slotPlayer(loaded.match, winnerSlot);
      if (!winnerId) return c.json({ error: 'В матче нет этого игрока' }, 400);

      const result = await setTechnicalResult(
        id,
        winnerId,
        reason ?? DEFAULT_TECHNICAL_REASON,
        c.get('appUser').id,
        botApi,
      );
      if (!result.success) return c.json({ error: result.error }, 400);
      return c.json(OK);
    },
  );

  // Итоговый счёт судьи — окончательный, без подтверждения игроков.
  router.post(
    '/matches/:id/result',
    validateParam(idParam),
    validateJson(scoreBody, SCORE_MESSAGES),
    async (c) => {
      const { id } = c.req.valid('param');
      const loaded = await loadManagedMatch(c, id, true);
      if ('error' in loaded) return loaded.error;

      const { player1Score, player2Score } = c.req.valid('json');
      const result = await recordRefereeResult(
        id,
        c.get('appUser').id,
        { kind: 'score', player1Score, player2Score },
        botApi,
      );
      if (!result.success) return c.json({ error: result.error }, 400);
      return c.json({ data: { wasDisputed: result.wasDisputed } });
    },
  );

  // Итоговый результат по фреймам (снукер).
  router.post(
    '/matches/:id/result-frames',
    validateParam(idParam),
    validateJson(framesBody, FRAMES_MESSAGES),
    async (c) => {
      const { id } = c.req.valid('param');
      const loaded = await loadManagedMatch(c, id, true);
      if ('error' in loaded) return loaded.error;

      const { frames } = c.req.valid('json');
      const result = await recordRefereeResult(
        id,
        c.get('appUser').id,
        {
          kind: 'frames',
          frames: frames.map((f) => ({
            player1Points: f.player1Points,
            player2Points: f.player2Points,
            player1Break: f.player1Break ?? null,
            player2Break: f.player2Break ?? null,
          })),
        },
        botApi,
      );
      if (!result.success) return c.json({ error: result.error }, 400);
      return c.json({ data: { wasDisputed: result.wasDisputed } });
    },
  );

  // Черновик фреймов по ходу матча (тот же, что ведут игроки).
  router.put(
    '/matches/:id/frames/:frameNumber',
    validateParam(idFrameNumberParam),
    validateJson(frameSchema, FRAME_MESSAGES),
    async (c) => {
      const { id, frameNumber } = c.req.valid('param');
      const loaded = await loadManagedMatch(c, id, true);
      if ('error' in loaded) return loaded.error;

      const f = c.req.valid('json');
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

  router.delete(
    '/matches/:id/frames/last',
    validateParam(idParam),
    async (c) => {
      const { id } = c.req.valid('param');
      const loaded = await loadManagedMatch(c, id, true);
      if ('error' in loaded) return loaded.error;

      const result = await deleteLastMatchFrame(id);
      if (!result.success) return c.json({ error: result.error }, 400);
      return c.json({ data: result.frames.map(toFrameDto) });
    },
  );

  // Закрепить / сменить / снять стол. Если стол держит другой незавершённый
  // матч — 409, пока судья не подтвердит (`force`): setMatchTable отбирает
  // стол молча.
  router.put(
    '/matches/:id/table',
    validateParam(idParam),
    validateJson(tableBody, { tableId: 'Некорректный стол' }),
    async (c) => {
      const { id } = c.req.valid('param');
      const loaded = await loadManagedMatch(c, id, true);
      if ('error' in loaded) return loaded.error;
      if (!isActive(loaded.match)) {
        return c.json({ error: 'Матч уже завершён' }, 409);
      }

      const { tableId, force } = c.req.valid('json');
      if (tableId !== null && force !== true) {
        const holder = await findMatchHoldingTable(tableId as UUID, id);
        if (holder) {
          const names = [
            playerSlotName({
              name: holder.player1Name,
              surname: holder.player1Surname,
              username: holder.player1Username,
            }),
            playerSlotName({
              name: holder.player2Name,
              surname: holder.player2Surname,
              username: holder.player2Username,
            }),
          ].join(' — ');
          return c.json(
            { error: `Стол занят матчем ${names}`, holderMatchId: holder.id },
            409,
          );
        }
      }

      const result = await setMatchTable(id, tableId as UUID | null, botApi);
      if (!result.success) return c.json({ error: result.error }, 400);
      return c.json(OK);
    },
  );

  // Вызвать ожидающий матч к конкретному свободному столу.
  router.post(
    '/matches/:id/call',
    validateParam(idParam),
    validateJson(callBody, { tableId: 'Некорректный стол' }),
    async (c) => {
      const { id } = c.req.valid('param');
      const loaded = await loadManagedMatch(c, id, true);
      if ('error' in loaded) return loaded.error;

      const { tableId } = c.req.valid('json');
      const result = await callMatchToTable(id, tableId as UUID, botApi);
      if (!result.success) return c.json({ error: result.error }, 400);
      return c.json(OK);
    },
  );

  // Время матча (только per_match). ISO-8601 UTC или null — сбросить.
  router.put(
    '/matches/:id/schedule',
    validateParam(idParam),
    validateJson(scheduleBody, { scheduledAt: 'Некорректная дата' }),
    async (c) => {
      const { id } = c.req.valid('param');
      const loaded = await loadManagedMatch(c, id, true);
      if ('error' in loaded) return loaded.error;
      const { match, tournament } = loaded;
      if (tournament.scheduleMode !== 'per_match') {
        return c.json(
          { error: 'Время назначается только в турнирах с расписанием' },
          409,
        );
      }
      if (!isActive(match)) {
        return c.json({ error: 'Матч уже завершён' }, 409);
      }

      const { scheduledAt } = c.req.valid('json');
      const date = scheduledAt ? new Date(scheduledAt) : null;
      const result = await setMatchSchedule(id, date);
      if (!result.success) {
        return c.json({ error: result.error ?? 'Ошибка' }, 400);
      }

      if (date || result.previous) {
        try {
          const updated = await getMatch(id);
          if (updated) {
            await (date
              ? notifyMatchScheduled(botApi, updated, tournament.name, date)
              : notifyMatchScheduleCleared(botApi, updated, tournament.name));
          }
        } catch (err) {
          console.error(`Failed to notify match schedule for ${id}:`, err);
        }
      }

      return c.json(OK);
    },
  );

  return router;
}
