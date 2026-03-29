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
} from '@/services/tournamentService.js';
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
    zValidator('json', z.object({ userId: z.uuid() })),
    async (c) => {
      const tournamentId = c.req.param('id') as UUID;
      const { userId } = c.req.valid('json') as { userId: UUID };

      await db
        .insert(tournamentParticipants)
        .values({ tournamentId, userId, status: 'confirmed' })
        .onConflictDoNothing();

      return c.json({ ok: true });
    },
  );

  router.delete('/:id/participants/:userId', async (c) => {
    const tournamentId = c.req.param('id') as UUID;
    const userId = c.req.param('userId') as UUID;

    await db
      .delete(tournamentParticipants)
      .where(
        and(
          eq(tournamentParticipants.tournamentId, tournamentId),
          eq(tournamentParticipants.userId, userId),
        ),
      );

    return c.json({ ok: true });
  });

  return router;
}
