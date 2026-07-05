import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';

import { db } from '@/db/db.js';
import { userIdentities, users } from '@/db/schema.js';
import {
  toAppUser,
  updateUserProfile,
  ProfileValidationError,
  MAX_NAME_LENGTH,
  MAX_SURNAME_LENGTH,
} from '@/services/userService.js';
import { verifyTelegramLogin } from '../telegramLogin.js';
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

  // Привязка Telegram к текущему аккаунту из профиля (Этап 7). Payload читаем
  // сырым — как в /api/app/auth/telegram (см. коммент там про data_check_string).
  router.post('/telegram', async (c) => {
    const user = c.get('appUser');

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Некорректные данные Telegram' }, 400);
    }

    const verified = verifyTelegramLogin(body, process.env.BOT_TOKEN ?? '');
    if (!verified.ok) {
      // Причину клиенту не раскрываем; в лог — конкретный reason для диагностики.
      console.warn('Telegram link rejected:', verified.reason);
      return c.json({ error: 'Не удалось подтвердить Telegram' }, 401);
    }
    const tg = verified.data;

    // Этот Telegram уже привязан к какому-то аккаунту?
    const existing = await db.query.userIdentities.findFirst({
      where: and(
        eq(userIdentities.provider, 'telegram'),
        eq(userIdentities.providerId, tg.id),
      ),
    });
    if (existing) {
      if (existing.userId === user.id) {
        return c.json({ data: { telegramLinked: true } }); // уже привязан — идемпотентно
      }
      return c.json(
        { error: 'Этот Telegram уже привязан к другому аккаунту' },
        409,
      );
    }

    // У текущего аккаунта уже есть другой Telegram? (уникальность (user_id, provider))
    const ownTelegram = await db.query.userIdentities.findFirst({
      where: and(
        eq(userIdentities.userId, user.id),
        eq(userIdentities.provider, 'telegram'),
      ),
    });
    if (ownTelegram) {
      return c.json(
        { error: 'К аккаунту уже привязан другой Telegram' },
        409,
      );
    }

    // Вставляем identity и заполняем users.telegram_id, если он пуст — после этого
    // юзеру доставляются Telegram-уведомления (инвариант бота).
    await db.transaction(async (tx) => {
      await tx
        .insert(userIdentities)
        .values({ userId: user.id, provider: 'telegram', providerId: tg.id })
        .onConflictDoNothing({
          target: [userIdentities.provider, userIdentities.providerId],
        });
      await tx
        .update(users)
        .set({ telegram_id: tg.id })
        .where(and(eq(users.id, user.id), isNull(users.telegram_id)));
    });

    return c.json({ data: { telegramLinked: true } });
  });

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
