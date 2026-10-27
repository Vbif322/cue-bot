import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import { users, tournamentReferees, tournaments } from '@/db/schema.js';
import {
  anonymizeUser,
  ProfileValidationError,
  toApiUser,
  toApiUserPublic,
  updateUserProfile,
} from '@/services/userService.js';
import {
  getUserMatchStats,
  getUserCompletedTournaments,
} from '@/services/userStatsService.js';
import type { Api } from 'grammy';

import {
  getOrganizerUsage,
  isUserInFederationRoster,
  listFederationRoster,
  setOrganizerLimits,
  setOrganizerUntil,
} from '@/services/federationService.js';
import { organizerCommands } from '@/bot/commands.js';
import { DateTimeHelperInstance } from '@/utils/dateTimeHelper.js';
import { errorMessage } from '@/utils/errors.js';
import { getUserRefereeTournaments } from '@/bot/permissions.js';
import type { ApiOrganizerUsage, ApiUserStats } from '@/bot/@types/user.js';
import type { DbUser } from '@/bot/types.js';
import { requireAdmin, requireStaff } from '../middleware.js';
import type { AdminUser } from '../middleware.js';
import {
  validateParam,
  idParam,
  idTournamentIdParam,
  loadManagedTournament,
  federationFilterFromQuery,
} from './_shared.js';

/**
 * Пользователи в панели. Платформенный админ видит всех и полные контакты.
 * Организатор видит **ростер** своих федераций (участники их турниров, команда,
 * заведённые ими гости) без контактов, плюс точный поиск по `@username`, чтобы
 * позвать игрока «со стороны». Роли и удаление — только админ.
 */
export function createUsersRouter(botApi: Api) {
  const router = new Hono();

  router.use('/*', requireStaff);

  const project = (admin: AdminUser, u: DbUser) =>
    admin.isPlatformAdmin ? toApiUser(u) : toApiUserPublic(u);

  /** Виден ли пользователь актору (админ — любой; организатор — из ростера). */
  const canSee = async (admin: AdminUser, userId: UUID): Promise<boolean> =>
    admin.isPlatformAdmin ||
    isUserInFederationRoster(userId, admin.federationIds);

  // List: admin — всех (или ростер ?federationId=); staff — ростер своих
  // федераций. `?q=@username` — точный поиск среди Telegram-аккаунтов.
  router.get('/', async (c) => {
    const admin = c.get('adminUser');
    const filter = federationFilterFromQuery(c);
    if (filter.error) return filter.error;

    const rosterIds =
      filter.federationId !== undefined && filter.federationId !== null
        ? [filter.federationId]
        : admin.isPlatformAdmin
          ? null
          : admin.federationIds;

    const list =
      rosterIds === null
        ? await db.query.users.findMany({
            where: (u, { isNull }) => isNull(u.deletedAt),
            orderBy: (u, { asc }) => [asc(u.username)],
          })
        : await listFederationRoster(rosterIds);

    const q = c.req.query('q')?.trim();
    if (q?.startsWith('@') && q.length > 1) {
      const found = await db.query.users.findFirst({
        where: and(
          eq(users.username, q.slice(1)),
          isNotNull(users.telegram_id),
          isNull(users.deletedAt),
        ),
      });
      if (found && !list.some((u) => u.id === found.id)) list.push(found);
    }

    return c.json({ data: list.map((u) => project(admin, u)) });
  });

  router.get('/:id', validateParam(idParam), async (c) => {
    const admin = c.get('adminUser');
    const { id } = c.req.valid('param');
    const user = await db.query.users.findFirst({
      where: eq(users.id, id),
    });
    if (!user || !(await canSee(admin, id))) {
      return c.json({ error: 'Не найден' }, 404);
    }
    return c.json({ data: project(admin, user) });
  });

  // Aggregated statistics for the user detail page. Организатору история и
  // судейство показываются только по турнирам его федераций.
  router.get('/:id/stats', validateParam(idParam), async (c) => {
    const admin = c.get('adminUser');
    const { id: userId } = c.req.valid('param');
    if (!(await canSee(admin, userId))) {
      return c.json({ error: 'Не найден' }, 404);
    }

    const [matches, history, refereeIds] = await Promise.all([
      getUserMatchStats(userId),
      getUserCompletedTournaments(userId, 100),
      getUserRefereeTournaments(userId),
    ]);

    const scopeIds = admin.isPlatformAdmin ? null : admin.federationIds;
    const refereeTournaments =
      refereeIds.length > 0
        ? await db
            .select({
              id: tournaments.id,
              name: tournaments.name,
              status: tournaments.status,
            })
            .from(tournaments)
            .where(
              and(
                inArray(tournaments.id, refereeIds),
                scopeIds === null
                  ? undefined
                  : inArray(tournaments.federationId, scopeIds),
              ),
            )
        : [];

    let visibleHistory = history;
    if (scopeIds !== null && history.length > 0) {
      const own = await db
        .select({ id: tournaments.id })
        .from(tournaments)
        .where(
          and(
            inArray(
              tournaments.id,
              history.map((t) => t.id),
            ),
            inArray(tournaments.federationId, scopeIds),
          ),
        );
      const ownIds = new Set(own.map((t) => t.id));
      visibleHistory = history.filter((t) => ownIds.has(t.id));
    }

    const stats: ApiUserStats = {
      matches,
      tournamentHistory: visibleHistory.map((t) => ({
        id: t.id,
        name: t.name,
        completedAt: t.completedAt.toISOString(),
        isWinner: t.isWinner,
      })),
      refereeTournaments,
    };

    return c.json({ data: stats });
  });

  // Update user profile (name / surname / city). Организатор — только гостей
  // своих федераций (у них нет своего входа, править их больше некому).
  router.patch(
    '/:id',
    validateParam(idParam),
    zValidator(
      'json',
      z.object({
        name: z.string().max(50).nullable().optional(),
        surname: z.string().max(100).nullable().optional(),
        city: z.string().max(100).nullable().optional(),
      }),
    ),
    async (c) => {
      const admin = c.get('adminUser');
      const { id: targetId } = c.req.valid('param');
      if (!admin.isPlatformAdmin) {
        const target = await db.query.users.findFirst({
          where: eq(users.id, targetId),
          columns: { createdByFederationId: true, telegram_id: true },
        });
        const isOwnGuest =
          target?.telegram_id === null &&
          target.createdByFederationId !== null &&
          admin.federationIds.includes(target.createdByFederationId);
        if (!isOwnGuest) return c.json({ error: 'Недостаточно прав' }, 403);
      }
      try {
        const updated = await updateUserProfile(targetId, c.req.valid('json'));
        return c.json({ data: project(admin, updated) });
      } catch (err) {
        if (err instanceof ProfileValidationError) {
          return c.json({ error: err.message }, 400);
        }
        throw err;
      }
    },
  );

  // Update user role — platform admin only
  router.patch(
    '/:id/role',
    requireAdmin,
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

  // Право организатора (платная опция) — выдать/продлить до даты или снять
  // (`until: null`). Только платформенный админ. Действующее право открывает
  // /new_federation и вход в панель; по истечении организации владельца
  // перестают создавать новые турниры, текущие доигрываются.
  router.patch(
    '/:id/organizer',
    requireAdmin,
    validateParam(idParam),
    zValidator('json', z.object({ until: z.iso.datetime().nullable() })),
    async (c) => {
      const { id: targetId } = c.req.valid('param');
      const raw = c.req.valid('json').until;
      const until = raw === null ? null : new Date(raw);
      if (until !== null && until <= new Date()) {
        return c.json({ error: 'Дата окончания должна быть в будущем' }, 400);
      }

      const before = await db.query.users.findFirst({
        where: eq(users.id, targetId),
      });
      if (!before || !(await setOrganizerUntil(targetId, until))) {
        return c.json({ error: 'Не найден' }, 404);
      }

      // Выдача / продление — уведомление и меню организатора в Telegram.
      if (until !== null && before.telegram_id) {
        const untilText = DateTimeHelperInstance.formatDate(
          until,
          'DD.MM.YYYY',
        );
        const chatId = parseInt(before.telegram_id, 10);
        const extended =
          before.organizerUntil !== null && before.organizerUntil > new Date();
        try {
          await botApi.sendMessage(
            chatId,
            extended
              ? `Право организатора продлено до ${untilText}.`
              : `Вам выдано право организатора до ${untilText}.\n\n` +
                  'Создайте свою организацию: /new_federation — после этого ' +
                  'станут доступны /create_tournament и /dashboard.',
          );
          await botApi.setMyCommands(organizerCommands, {
            scope: { type: 'chat', chat_id: chatId },
          });
        } catch (error) {
          console.error(
            'Не удалось уведомить организатора:',
            errorMessage(error),
          );
        }
      }

      const updated = await db.query.users.findFirst({
        where: eq(users.id, targetId),
      });
      if (!updated) return c.json({ error: 'Не найден' }, 404);
      return c.json({ data: toApiUser(updated) });
    },
  );

  // Тариф организатора: сколько организаций он заводит сам и сколько турниров
  // в месяц суммарно создают его организации. Только платформенный админ.
  router.get(
    '/:id/organizer/usage',
    requireAdmin,
    validateParam(idParam),
    async (c) => {
      const usage = await getOrganizerUsage(c.req.valid('param').id);
      if (!usage) return c.json({ error: 'Не найден' }, 404);
      return c.json({ data: usage satisfies ApiOrganizerUsage });
    },
  );

  router.patch(
    '/:id/organizer/limits',
    requireAdmin,
    validateParam(idParam),
    zValidator(
      'json',
      z
        .object({
          maxFederations: z.number().int().min(0).max(1000).optional(),
          maxTournamentsPerMonth: z.number().int().min(0).max(10000).optional(),
        })
        .refine(
          (b) =>
            b.maxFederations !== undefined ||
            b.maxTournamentsPerMonth !== undefined,
          { message: 'Укажите хотя бы один лимит' },
        ),
    ),
    async (c) => {
      const { id: targetId } = c.req.valid('param');
      const { maxFederations, maxTournamentsPerMonth } = c.req.valid('json');
      const ok = await setOrganizerLimits(targetId, {
        ...(maxFederations !== undefined ? { maxFederations } : {}),
        ...(maxTournamentsPerMonth !== undefined
          ? { maxTournamentsPerMonth }
          : {}),
      });
      if (!ok) return c.json({ error: 'Не найден' }, 404);
      const updated = await db.query.users.findFirst({
        where: eq(users.id, targetId),
      });
      if (!updated) return c.json({ error: 'Не найден' }, 404);
      return c.json({ data: toApiUser(updated) });
    },
  );

  // "Delete" user — anonymize (soft-delete), platform admin only. The row is kept
  // so past matches and tournaments stay intact, displayed as «Удалённый аккаунт».
  router.delete('/:id', requireAdmin, validateParam(idParam), async (c) => {
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

  // Assign referee to tournament (administer-level on the tournament)
  router.post(
    '/:id/referee',
    validateParam(idParam),
    zValidator('json', z.object({ tournamentId: z.uuid() })),
    async (c) => {
      const { id: userId } = c.req.valid('param');
      const { tournamentId } = c.req.valid('json') as { tournamentId: UUID };

      const res = await loadManagedTournament(c, tournamentId, 'administer');
      if (res.error) return res.error;

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

      const res = await loadManagedTournament(c, tournamentId, 'administer');
      if (res.error) return res.error;

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
