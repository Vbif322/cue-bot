import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import type { Api } from 'grammy';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import {
  maxParticipants,
  tournamentParticipants,
  users,
  winScores,
  type ITournamentMaxParticipants,
  type ITournamentWinScore,
} from '@/db/schema.js';
import {
  createTournamentDraft,
  getTournament,
  getTournaments,
  updateTournamentStatus,
  deleteTournament,
  canDeleteTournament,
  closeRegistrationWithCount,
  canStartTournament,
  confirmParticipant,
  rejectParticipant,
  deleteParticipant,
} from '@/services/tournamentService.js';
import {
  notifyRegistrationConfirmed,
  notifyRegistrationRejected,
} from '@/services/notificationService.js';
import { startTournamentFull } from '@/services/tournamentStartService.js';
import { getMatchStats } from '@/services/matchService.js';
import { getTournamentTables } from '@/services/tableService.js';
import { requireAdmin } from '../middleware.js';

export function createTournamentsRouter(botApi: Api) {
  const router = new Hono();

  router.use('/*', requireAdmin);

  router.get('/', async (c) => {
    const list = await getTournaments({ limit: 100, includesDrafts: true });
    return c.json({ data: list });
  });

  router.get('/:id', async (c) => {
    const tournament = await getTournament(c.req.param('id') as UUID);
    if (!tournament) return c.json({ error: 'Не найден' }, 404);
    return c.json({ data: tournament });
  });

  router.get('/:id/tables', async (c) => {
    const list = await getTournamentTables(c.req.param('id') as UUID);
    return c.json({ data: list });
  });

  router.post(
    '/',
    zValidator(
      'json',
      z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        rules: z.string().optional(),
        format: z.enum([
          'single_elimination',
          'double_elimination',
          'round_robin',
        ]),
        maxParticipants: z
          .number()
          .int()
          .min(Math.min(...maxParticipants))
          .max(Math.max(...maxParticipants))
          .default(16),
        winScore: z
          .number()
          .int()
          .min(Math.min(...winScores))
          .max(Math.max(...winScores))
          .default(3),
        startDate: z.string().optional(),
        venueId: z.uuid(),
        tableIds: z.array(z.uuid()).optional(),
      }),
    ),
    async (c) => {
      const body = c.req.valid('json');
      const admin = c.get('adminUser');

      try {
        const tournament = await createTournamentDraft({
          name: body.name,
          description: body.description ?? null,
          rules: body.rules ?? null,
          discipline: 'snooker',
          format: body.format,
          maxParticipants: body.maxParticipants as ITournamentMaxParticipants,
          winScore: body.winScore as ITournamentWinScore,
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
    '/:id/status',
    zValidator(
      'json',
      z.object({
        status: z.enum([
          'draft',
          'registration_open',
          'registration_closed',
          'in_progress',
          'completed',
          'cancelled',
        ]),
      }),
    ),
    async (c) => {
      const { status } = c.req.valid('json');
      const id = c.req.param('id') as UUID;

      if (status === 'registration_closed') {
        await closeRegistrationWithCount(id);
      } else {
        await updateTournamentStatus(id, status);
      }

      const updated = await getTournament(id);
      return c.json({ data: updated });
    },
  );

  router.post('/:id/start', async (c) => {
    const id = c.req.param('id') as UUID;

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

  router.delete('/:id', async (c) => {
    const id = c.req.param('id') as UUID;
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

  router.get('/:id/participants', async (c) => {
    const id = c.req.param('id') as UUID;

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

  router.get('/:id/stats', async (c) => {
    const stats = await getMatchStats(c.req.param('id') as UUID);
    return c.json({ data: stats });
  });

  router.post(
    '/:id/participants',
    zValidator(
      'json',
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('user'), userId: z.string().uuid() }),
        z.object({
          type: z.literal('external'),
          name: z.string().min(1).max(255),
          username: z.string().max(255).optional(),
        }),
      ]),
    ),
    async (c) => {
      const tournamentId = c.req.param('id') as UUID;
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
        userId = newUser.id as UUID;
      } else {
        userId = body.userId as UUID;
      }

      await db
        .insert(tournamentParticipants)
        .values({ tournamentId, userId, status: 'confirmed' })
        .onConflictDoNothing();

      return c.json({ ok: true });
    },
  );

  router.patch(
    '/:id/participants/:userId',
    zValidator('json', z.object({ action: z.enum(['confirm', 'reject']) })),
    async (c) => {
      const tournamentId = c.req.param('id');
      const userId = c.req.param('userId');
      const { action } = c.req.valid('json');

      const tournament = await getTournament(tournamentId);
      if (!tournament) return c.json({ error: 'Турнир не найден' }, 404);

      if (
        tournament.status !== 'registration_open' &&
        tournament.status !== 'registration_closed'
      ) {
        return c.json(
          {
            error: 'Подтверждение участников доступно только во время регистрации',
          },
          400,
        );
      }

      if (action === 'confirm') {
        const updated = await confirmParticipant(tournamentId, userId);
        if (updated) {
          await notifyRegistrationConfirmed(botApi, userId, tournamentId, tournament.name);
        }
      } else {
        const updated = await rejectParticipant(tournamentId, userId);
        if (updated) {
          await notifyRegistrationRejected(botApi, userId, tournamentId, tournament.name);
        }
      }

      return c.json({ ok: true });
    },
  );

  router.delete('/:id/participants/:userId', async (c) => {
    const tournamentId = c.req.param('id') as UUID;
    const userId = c.req.param('userId') as UUID;

    await deleteParticipant(tournamentId, userId);

    return c.json({ ok: true });
  });

  return router;
}
