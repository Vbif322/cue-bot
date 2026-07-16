import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, isNotNull, sql } from 'drizzle-orm';

import { db } from '@/db/db.js';
import { userIdentities, tournamentParticipants } from '@/db/schema.js';
import {
  toAppUser,
  updateUserProfile,
  ProfileValidationError,
  MAX_NAME_LENGTH,
  MAX_SURNAME_LENGTH,
} from '@/services/userService.js';
import { getUserTournaments } from '@/services/tournamentService.js';
import {
  getUserMatchStats,
  getUserCompletedTournaments,
} from '@/services/userStatsService.js';
import {
  getPlayerActiveMatches,
  getPlayerMatchHistory,
} from '@/services/matchService.js';
import { requireUser } from '@/admin/server/middleware.js';

import { validateJson } from './_shared.js';
import { readMergeIntent } from './auth.js';

const profileBody = z.object({
  name: z.string().max(MAX_NAME_LENGTH).nullable().optional(),
  surname: z.string().max(MAX_SURNAME_LENGTH).nullable().optional(),
});

const PROFILE_MESSAGES = {
  name: 'Некорректное имя',
  surname: 'Некорректная фамилия',
} as const;

export function createAppMeRouter() {
  const router = new Hono();

  router.use('/*', requireUser);

  router.get('/', async (c) => {
    const user = c.get('appUser');
    const [emailIdentity, telegramIdentity] = await Promise.all([
      db.query.userIdentities.findFirst({
        where: and(
          eq(userIdentities.userId, user.id),
          eq(userIdentities.provider, 'email'),
          isNotNull(userIdentities.emailVerifiedAt),
        ),
      }),
      db.query.userIdentities.findFirst({
        where: and(
          eq(userIdentities.userId, user.id),
          eq(userIdentities.provider, 'telegram'),
        ),
      }),
    ]);

    // Если для этой сессии висит подтверждённое через OIDC «намерение слияния»
    // (кука tg_merge относится к текущему аккаунту как к losing), отдаём счётчики
    // истории survivor'а — чтобы карточка на /profile показала, с чем сливаемся.
    const mergeIntent = await readMergeIntent(c);
    let pendingMerge:
      | { survivorTournaments: number; survivorMatches: number }
      | undefined;
    if (mergeIntent?.losingUserId === user.id) {
      const survivorId = mergeIntent.survivorUserId;
      const [[participation], stats] = await Promise.all([
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(tournamentParticipants)
          .where(eq(tournamentParticipants.userId, survivorId)),
        getUserMatchStats(survivorId),
      ]);
      pendingMerge = {
        survivorTournaments: participation?.count ?? 0,
        survivorMatches: stats.played,
      };
    }

    return c.json({
      data: {
        ...toAppUser(user),
        emailVerified: emailIdentity != null,
        telegramLinked: telegramIdentity != null,
        ...(pendingMerge ? { pendingMerge } : {}),
      },
    });
  });

  // Привязка Telegram выполняется через OIDC-редирект:
  // GET /api/app/auth/telegram/start?link=1 → callback (см. app/server/routes/auth.ts).
  // Здесь POST-эндпоинта больше нет — виджет/HMAC-подпись сняты вместе с миграцией.

  router.patch('/', validateJson(profileBody, PROFILE_MESSAGES), async (c) => {
    const body = c.req.valid('json');
    try {
      const updated = await updateUserProfile(c.get('appUser').id, body);
      return c.json({ data: toAppUser(updated) });
    } catch (error) {
      if (error instanceof ProfileValidationError) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  });

  router.get('/stats', async (c) => {
    const userId = c.get('appUser').id;
    const [matches, tournamentHistory] = await Promise.all([
      getUserMatchStats(userId),
      getUserCompletedTournaments(userId),
    ]);
    return c.json({ data: { matches, tournamentHistory } });
  });

  router.get('/tournaments', async (c) => {
    return c.json({ data: await getUserTournaments(c.get('appUser').id) });
  });

  router.get('/matches', async (c) => {
    const userId = c.get('appUser').id;
    const [active, history] = await Promise.all([
      getPlayerActiveMatches(userId),
      getPlayerMatchHistory(userId),
    ]);
    return c.json({ data: { active, history } });
  });

  return router;
}
