import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, isNotNull } from 'drizzle-orm';

import { db } from '@/db/db.js';
import { userIdentities } from '@/db/schema.js';
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

    return c.json({
      data: {
        ...toAppUser(user),
        emailVerified: emailIdentity != null,
        telegramLinked: telegramIdentity != null,
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
