import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and, inArray } from 'drizzle-orm';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import { users, tournamentReferees, tournaments } from '@/db/schema.js';
import {
  anonymizeUser,
  ProfileValidationError,
  toApiUser,
  updateUserProfile,
} from '@/services/userService.js';
import {
  getUserMatchStats,
  getUserCompletedTournaments,
} from '@/services/userStatsService.js';
import { getUserRefereeTournaments } from '@/bot/permissions.js';
import type { ApiUserStats } from '@/bot/@types/user.js';
import { requireAdmin } from '../middleware.js';
import { validateParam, idParam, idTournamentIdParam } from './_shared.js';

export function createUsersRouter() {
  const router = new Hono();

  router.use('/*', requireAdmin);

  // List all users (tombstoned/anonymized accounts are hidden)
  router.get('/', async (c) => {
    const allUsers = await db.query.users.findMany({
      where: (u, { isNull }) => isNull(u.deletedAt),
      orderBy: (u, { asc }) => [asc(u.username)],
    });
    return c.json({ data: allUsers.map(toApiUser) });
  });

  // Get single user
  router.get('/:id', validateParam(idParam), async (c) => {
    const { id } = c.req.valid('param');
    const user = await db.query.users.findFirst({
      where: eq(users.id, id),
    });
    if (!user) return c.json({ error: 'Не найден' }, 404);
    return c.json({ data: toApiUser(user) });
  });

  // Aggregated statistics for the user detail page
  router.get('/:id/stats', validateParam(idParam), async (c) => {
    const { id: userId } = c.req.valid('param');

    const [matches, history, refereeIds] = await Promise.all([
      getUserMatchStats(userId),
      getUserCompletedTournaments(userId, 100),
      getUserRefereeTournaments(userId),
    ]);

    const refereeTournaments =
      refereeIds.length > 0
        ? await db
            .select({
              id: tournaments.id,
              name: tournaments.name,
              status: tournaments.status,
            })
            .from(tournaments)
            .where(inArray(tournaments.id, refereeIds))
        : [];

    const stats: ApiUserStats = {
      matches,
      tournamentHistory: history.map((t) => ({
        id: t.id,
        name: t.name,
        completedAt: t.completedAt.toISOString(),
        isWinner: t.isWinner,
      })),
      refereeTournaments,
    };

    return c.json({ data: stats });
  });

  // Update user profile (name / surname)
  router.patch(
    '/:id',
    validateParam(idParam),
    zValidator(
      'json',
      z.object({
        name: z.string().max(50).nullable().optional(),
        surname: z.string().max(100).nullable().optional(),
      }),
    ),
    async (c) => {
      const { id: targetId } = c.req.valid('param');
      try {
        const updated = await updateUserProfile(targetId, c.req.valid('json'));
        return c.json({ data: toApiUser(updated) });
      } catch (err) {
        if (err instanceof ProfileValidationError) {
          return c.json({ error: err.message }, 400);
        }
        throw err;
      }
    },
  );

  // Update user role
  router.patch(
    '/:id/role',
    validateParam(idParam),
    zValidator('json', z.object({ role: z.enum(['user', 'admin']) })),
    async (c) => {
      const admin = c.get('adminUser');
      const { id: targetId } = c.req.valid('param');

      if (admin.id === targetId) {
        return c.json({ error: 'Нельзя изменить собственную роль' }, 400);
      }

      await db
        .update(users)
        .set({ role: c.req.valid('json').role })
        .where(eq(users.id, targetId));

      const updated = await db.query.users.findFirst({
        where: eq(users.id, targetId),
      });

      if (!updated) return c.json({ error: 'Не найден' }, 404);
      return c.json({ data: toApiUser(updated) });
    },
  );

  // "Delete" user — anonymize (soft-delete). The row is kept so past matches and
  // tournaments stay intact, displayed as «Удалённый аккаунт».
  router.delete('/:id', validateParam(idParam), async (c) => {
    const admin = c.get('adminUser');
    const { id: targetId } = c.req.valid('param');

    if (admin.id === targetId) {
      return c.json({ error: 'Нельзя удалить собственный аккаунт' }, 400);
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, targetId),
    });

    if (!user) return c.json({ error: 'Не найден' }, 404);
    if (user.deletedAt) return c.json({ ok: true }); // idempotent

    await anonymizeUser(targetId);
    return c.json({ ok: true });
  });

  // Assign referee to tournament
  router.post(
    '/:id/referee',
    validateParam(idParam),
    zValidator('json', z.object({ tournamentId: z.uuid() })),
    async (c) => {
      const { id: userId } = c.req.valid('param');
      const { tournamentId } = c.req.valid('json') as { tournamentId: UUID };

      await db
        .insert(tournamentReferees)
        .values({ userId, tournamentId })
        .onConflictDoNothing();

      return c.json({ ok: true });
    },
  );

  // Remove referee from tournament
  router.delete(
    '/:id/referee/:tournamentId',
    validateParam(idTournamentIdParam),
    async (c) => {
      const { id: userId, tournamentId } = c.req.valid('param');

      await db
        .delete(tournamentReferees)
        .where(
          and(
            eq(tournamentReferees.userId, userId),
            eq(tournamentReferees.tournamentId, tournamentId),
          ),
        );

      return c.json({ ok: true });
    },
  );

  return router;
}
