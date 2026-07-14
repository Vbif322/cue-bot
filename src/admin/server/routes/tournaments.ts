import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, inArray } from 'drizzle-orm';
import type { Api } from 'grammy';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import {
  formats,
  maxParticipants,
  mergeRounds,
  scheduleModes,
  sports,
  disciplines,
  statuses,
  tournamentParticipants,
  users,
  visibilities,
  winScores,
  groupDraws,
  validateGroupConfig,
  validateSportDiscipline,
  type ITournamentWinScore,
} from '@/db/schema.js';
import {
  createTournamentDraft,
  updateTournamentDraft,
  getTournament,
  getTournaments,
  updateTournamentStatus,
  deleteTournament,
  canDeleteTournament,
  cancelTournament,
  canTransitionTournamentStatus,
  canEditTournament,
  closeRegistrationWithCount,
  canStartTournament,
  confirmParticipant,
  rejectParticipant,
  deleteParticipant,
  setParticipantSeed,
  randomizeSeeds,
  registerParticipant,
} from '@/services/tournamentService.js';
import {
  notifyRegistrationConfirmed,
  notifyRegistrationRejected,
  notifyTournamentCancelled,
} from '@/services/notificationService.js';
import { startTournamentFull } from '@/services/tournamentStartService.js';
import { getMatchStats } from '@/services/matchService.js';
import { getGroupStandings, getGroupMaxBreaks } from '@/services/groupPhaseService.js';
import { clinchedUserIds } from '@/services/standingsService.js';
import { getTournamentTables } from '@/services/tableService.js';
import { requireAdmin } from '../middleware.js';
import { validateParam, idParam, idUserIdParam } from './_shared.js';

// Shared create/update body schema. For groups_playoff the four group fields are
// required and validated together; for the other formats maxParticipants must be
// one of the discrete sizes. maxParticipants for groups_playoff is derived in the
// handler (groupsCount × participantsPerGroup), so the range here stays permissive.
const tournamentBodySchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    rules: z.string().optional(),
    // Immutable after create: PATCH accepts but ignores the pair.
    sport: z.enum(sports),
    discipline: z.enum(disciplines),
    format: z.enum(formats),
    randomAdvancement: z.boolean().default(false),
    visibility: z.enum(visibilities).default('public'),
    scheduleMode: z.enum(scheduleModes).default('single_day'),
    maxParticipants: z.number().int().min(2).max(512).default(16),
    winScore: z
      .number()
      .int()
      .min(Math.min(...winScores))
      .max(Math.max(...winScores))
      .default(3),
    mergeRound: z
      .number()
      .int()
      .min(Math.min(...mergeRounds))
      .max(Math.max(...mergeRounds))
      .default(2),
    groupsCount: z.number().int().optional(),
    participantsPerGroup: z.number().int().optional(),
    qualifiersPerGroup: z.number().int().optional(),
    groupDraw: z.enum(groupDraws).optional(),
    startDate: z.string().optional(),
    venueId: z.uuid(),
    tableIds: z.array(z.uuid()).optional(),
  })
  .superRefine((data, ctx) => {
    const sportError = validateSportDiscipline(data.sport, data.discipline);
    if (sportError) ctx.addIssue({ code: 'custom', message: sportError });

    if (data.format === 'groups_playoff') {
      if (
        data.groupsCount == null ||
        data.participantsPerGroup == null ||
        data.qualifiersPerGroup == null ||
        data.groupDraw == null
      ) {
        ctx.addIssue({ code: 'custom', message: 'Не заданы параметры групп' });
        return;
      }
      const err = validateGroupConfig({
        groupsCount: data.groupsCount,
        participantsPerGroup: data.participantsPerGroup,
        qualifiersPerGroup: data.qualifiersPerGroup,
      });
      if (err) ctx.addIssue({ code: 'custom', message: err });
    } else if (
      !(maxParticipants as readonly number[]).includes(data.maxParticipants)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Недопустимое количество участников',
      });
    }
  });

/** Derive the persisted participant cap: full groups for groups_playoff. */
function resolveMaxParticipants(
  body: z.infer<typeof tournamentBodySchema>,
): number {
  if (
    body.format === 'groups_playoff' &&
    body.groupsCount != null &&
    body.participantsPerGroup != null
  ) {
    return body.groupsCount * body.participantsPerGroup;
  }
  return body.maxParticipants;
}

export function createTournamentsRouter(botApi: Api) {
  const router = new Hono();

  router.use('/*', requireAdmin);

  router.get('/', async (c) => {
    const list = await getTournaments({
      limit: 100,
      includesDrafts: true,
      includePrivate: true,
    });
    return c.json({ data: list });
  });

  router.get('/:id', validateParam(idParam), async (c) => {
    const { id } = c.req.valid('param');
    const tournament = await getTournament(id);
    if (!tournament) return c.json({ error: 'Не найден' }, 404);
    return c.json({ data: tournament });
  });

  router.get('/:id/tables', validateParam(idParam), async (c) => {
    const { id } = c.req.valid('param');
    const list = await getTournamentTables(id);
    return c.json({ data: list });
  });

  // Group-stage standings for the groups_playoff format (empty array otherwise).
  // Rows are enriched with player display names for the SPA.
  router.get('/:id/standings', validateParam(idParam), async (c) => {
    const { id } = c.req.valid('param');
    const [standings, tournament, maxBreakById] = await Promise.all([
      getGroupStandings(id),
      getTournament(id),
      getGroupMaxBreaks(id),
    ]);

    const ids = standings.flatMap((g) => g.rows.map((r) => r.userId));
    const nameById = new Map<string, { username: string | null; name: string | null }>();
    if (ids.length > 0) {
      const rows = await db.query.users.findMany({
        where: inArray(users.id, ids),
        columns: { id: true, username: true, name: true },
      });
      for (const u of rows) nameById.set(u.id, { username: u.username, name: u.name });
    }

    // A player plays (participantsPerGroup − 1) group matches; mark who has
    // already clinched a qualifying spot.
    const totalMatches = (tournament?.participantsPerGroup ?? 1) - 1;
    const qualifiers = tournament?.qualifiersPerGroup ?? 0;

    const data = standings.map((g) => {
      const clinched = clinchedUserIds(g.rows, totalMatches, qualifiers);
      return {
        groupIndex: g.groupIndex,
        rows: g.rows.map((r) => ({
          ...r,
          username: nameById.get(r.userId)?.username ?? null,
          name: nameById.get(r.userId)?.name ?? null,
          clinched: clinched.has(r.userId),
          maxBreak: maxBreakById.get(r.userId) ?? null,
        })),
      };
    });

    return c.json({ data });
  });

  router.post(
    '/',
    zValidator('json', tournamentBodySchema),
    async (c) => {
      const body = c.req.valid('json');
      const admin = c.get('adminUser');

      try {
        const tournament = await createTournamentDraft({
          name: body.name,
          description: body.description ?? null,
          rules: body.rules ?? null,
          sport: body.sport,
          discipline: body.discipline,
          format: body.format,
          randomAdvancement: body.randomAdvancement,
          visibility: body.visibility,
          scheduleMode: body.scheduleMode,
          maxParticipants: resolveMaxParticipants(body),
          winScore: body.winScore as ITournamentWinScore,
          mergeRound: body.mergeRound,
          groupsCount: body.groupsCount ?? null,
          participantsPerGroup: body.participantsPerGroup ?? null,
          qualifiersPerGroup: body.qualifiersPerGroup ?? null,
          groupDraw: body.groupDraw ?? null,
          startDate: body.startDate ? new Date(body.startDate) : null,
          venueId: body.venueId as UUID,
          ...(body.tableIds ? { tableIds: body.tableIds as UUID[] } : {}),
          createdBy: admin.id,
        });

        return c.json({ data: tournament }, 201);
      } catch (error) {
        return c.json(
          {
            error:
              error instanceof Error
                ? error.message
                : 'Ошибка создания турнира',
          },
          400,
        );
      }
    },
  );

  router.patch(
    '/:id',
    validateParam(idParam),
    zValidator('json', tournamentBodySchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');

      const existing = await getTournament(id);
      if (!existing) return c.json({ error: 'Не найден' }, 404);

      if (!canEditTournament(existing.status)) {
        return c.json(
          { error: 'Турнир уже стартовал — редактирование недоступно' },
          400,
        );
      }

      try {
        const tournament = await updateTournamentDraft(id, {
          name: body.name,
          description: body.description ?? null,
          rules: body.rules ?? null,
          format: body.format,
          randomAdvancement: body.randomAdvancement,
          visibility: body.visibility,
          scheduleMode: body.scheduleMode,
          maxParticipants: resolveMaxParticipants(body),
          winScore: body.winScore as ITournamentWinScore,
          mergeRound: body.mergeRound,
          groupsCount: body.groupsCount ?? null,
          participantsPerGroup: body.participantsPerGroup ?? null,
          qualifiersPerGroup: body.qualifiersPerGroup ?? null,
          groupDraw: body.groupDraw ?? null,
          startDate: body.startDate ? new Date(body.startDate) : null,
          venueId: body.venueId as UUID,
          ...(body.tableIds ? { tableIds: body.tableIds as UUID[] } : {}),
        });

        return c.json({ data: tournament });
      } catch (error) {
        return c.json(
          {
            error:
              error instanceof Error
                ? error.message
                : 'Ошибка обновления турнира',
          },
          400,
        );
      }
    },
  );

  router.patch(
    '/:id/status',
    validateParam(idParam),
    zValidator(
      'json',
      z.object({
        status: z.enum(statuses),
      }),
    ),
    async (c) => {
      const { status } = c.req.valid('json');
      const { id } = c.req.valid('param');

      const tournament = await getTournament(id);
      if (!tournament) return c.json({ error: 'Не найден' }, 404);

      // in_progress / completed are reached only via the dedicated start and
      // auto-complete flows, never a manual PATCH.
      if (status === 'in_progress' || status === 'completed') {
        return c.json({ error: 'Этот статус устанавливается автоматически' }, 400);
      }
      if (!canTransitionTournamentStatus(tournament.status, status)) {
        return c.json(
          { error: `Недопустимый переход: ${tournament.status} → ${status}` },
          400,
        );
      }

      if (status === 'cancelled') {
        await cancelTournament(id);
        await notifyTournamentCancelled(botApi, id, tournament.name);
      } else if (status === 'registration_closed') {
        await closeRegistrationWithCount(id);
      } else {
        await updateTournamentStatus(id, status);
      }

      const updated = await getTournament(id);
      return c.json({ data: updated });
    },
  );

  router.post('/:id/start', validateParam(idParam), async (c) => {
    const { id } = c.req.valid('param');

    const canStart = await canStartTournament(id);
    if (!canStart.canStart) {
      return c.json({ error: canStart.error }, 400);
    }

    try {
      const result = await startTournamentFull(id, botApi);
      return c.json({ data: result });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : 'Неизвестная ошибка' },
        500,
      );
    }
  });

  router.delete('/:id', validateParam(idParam), async (c) => {
    const { id } = c.req.valid('param');
    const tournament = await getTournament(id);

    if (!tournament) return c.json({ error: 'Не найден' }, 404);

    if (!canDeleteTournament(tournament.status)) {
      return c.json(
        { error: 'Можно удалять только черновики и отменённые турниры' },
        400,
      );
    }

    await deleteTournament(id);
    return c.json({ ok: true });
  });

  router.get('/:id/participants', validateParam(idParam), async (c) => {
    const { id } = c.req.valid('param');

    const dbParticipants = await db
      .select({
        userId: tournamentParticipants.userId,
        status: tournamentParticipants.status,
        seed: tournamentParticipants.seed,
        username: users.username,
        name: users.name,
      })
      .from(tournamentParticipants)
      .innerJoin(users, eq(tournamentParticipants.userId, users.id))
      .where(eq(tournamentParticipants.tournamentId, id));

    return c.json({ data: dbParticipants });
  });

  router.get('/:id/stats', validateParam(idParam), async (c) => {
    const { id } = c.req.valid('param');
    const stats = await getMatchStats(id);
    return c.json({ data: stats });
  });

  router.post(
    '/:id/participants',
    validateParam(idParam),
    zValidator(
      'json',
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('user'), userId: z.uuid() }),
        z.object({
          type: z.literal('external'),
          name: z.string().min(1).max(255),
          username: z.string().max(255).optional(),
        }),
      ]),
    ),
    async (c) => {
      const { id: tournamentId } = c.req.valid('param');
      const body = c.req.valid('json');

      let userId: UUID;

      if (body.type === 'external') {
        const [newUser] = await db
          .insert(users)
          .values({
            username: body.username ?? body.name.slice(0, 255),
            name: body.name,
          })
          .returning({ id: users.id });

        if (!newUser)
          return c.json({ error: 'Ошибка создания участника' }, 500);
        userId = newUser.id;
      } else {
        userId = body.userId as UUID;
      }

      // Atomic, cap-enforcing registration (advisory-locked per tournament).
      // Admin may add to non-open tournaments, so registration status isn't
      // required to be open here — only the participant limit is enforced.
      const outcome = await registerParticipant(tournamentId, userId, {
        desiredStatus: 'confirmed',
        requireOpen: false,
      });

      if (!outcome.ok) {
        if (outcome.reason === 'not_found') {
          return c.json({ error: 'Турнир не найден' }, 404);
        }
        if (outcome.reason === 'full') {
          return c.json({ error: 'Все места заняты' }, 409);
        }
        // already_registered → idempotent success (matches prior onConflictDoNothing)
      }

      return c.json({ ok: true });
    },
  );

  router.patch(
    '/:id/participants/:userId',
    validateParam(idUserIdParam),
    zValidator('json', z.object({ action: z.enum(['confirm', 'reject']) })),
    async (c) => {
      const { id: tournamentId, userId } = c.req.valid('param');
      const { action } = c.req.valid('json');

      const tournament = await getTournament(tournamentId);
      if (!tournament) return c.json({ error: 'Турнир не найден' }, 404);

      if (
        tournament.status !== 'registration_open' &&
        tournament.status !== 'registration_closed'
      ) {
        return c.json(
          {
            error:
              'Подтверждение участников доступно только во время регистрации',
          },
          400,
        );
      }

      if (action === 'confirm') {
        const updated = await confirmParticipant(tournamentId, userId);
        if (updated) {
          await notifyRegistrationConfirmed(
            botApi,
            userId,
            tournamentId,
            tournament.name,
          );
        }
      } else {
        const updated = await rejectParticipant(tournamentId, userId);
        if (updated) {
          await notifyRegistrationRejected(
            botApi,
            userId,
            tournamentId,
            tournament.name,
          );
        }
      }

      return c.json({ ok: true });
    },
  );

  router.delete(
    '/:id/participants/:userId',
    validateParam(idUserIdParam),
    async (c) => {
      const { id: tournamentId, userId } = c.req.valid('param');

      await deleteParticipant(tournamentId, userId);

      return c.json({ ok: true });
    },
  );

  router.patch(
    '/:id/participants/:userId/seed',
    validateParam(idUserIdParam),
    zValidator('json', z.object({ seed: z.number().int().min(1).nullable() })),
    async (c) => {
      const { id: tournamentId, userId } = c.req.valid('param');
      const { seed } = c.req.valid('json');

      const tournament = await getTournament(tournamentId);
      if (!tournament) return c.json({ error: 'Турнир не найден' }, 404);

      if (
        tournament.status !== 'registration_open' &&
        tournament.status !== 'registration_closed'
      ) {
        return c.json(
          { error: 'Сиды можно менять только во время регистрации' },
          400,
        );
      }

      try {
        await setParticipantSeed(tournamentId, userId, seed);
      } catch (err) {
        return c.json(
          {
            error: err instanceof Error ? err.message : 'Ошибка установки сида',
          },
          400,
        );
      }

      return c.json({ ok: true });
    },
  );

  router.post(
    '/:id/participants/seeds/randomize',
    validateParam(idParam),
    async (c) => {
      const { id: tournamentId } = c.req.valid('param');

      const tournament = await getTournament(tournamentId);
      if (!tournament) return c.json({ error: 'Турнир не найден' }, 404);

      if (
        tournament.status !== 'registration_open' &&
        tournament.status !== 'registration_closed'
      ) {
        return c.json(
          { error: 'Сиды можно менять только во время регистрации' },
          400,
        );
      }

      await randomizeSeeds(tournamentId);
      return c.json({ ok: true });
    },
  );

  return router;
}
