import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';

import { db } from '@/db/db.js';
import { userIdentities, users } from '@/db/schema.js';
import { RateLimiter } from '@/lib/rateLimiter.js';
import { createIpRateLimit } from '@/admin/server/middleware/rateLimit.js';
import {
  requireUser,
  signAppToken,
} from '@/admin/server/middleware.js';
import {
  findOrCreateEmailUser,
  getOrCreateTelegramUser,
  toAppUser,
} from '@/services/userService.js';
import {
  issueLoginCode,
  verifyLoginCode,
} from '@/services/emailLoginCodeService.js';
import { sendLoginCodeEmail } from '@/services/mailService.js';
import { verifyTelegramLogin } from '../telegramLogin.js';
import {
  generateLoginCode,
  hashCode,
  normalizeEmail,
} from '../authCrypto.js';
import { validateJson } from './_shared.js';

const APP_COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 дней

// Secure-флаг только в проде: на http://localhost браузер иначе отбросит куку в dev.
const APP_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'Strict',
  path: '/',
} as const;

/**
 * Пер-email лимит запросов кода (~3 / 15 мин), поверх пер-IP анти-флуда. При
 * превышении отвечаем обычным 200 без отправки — чтобы не выдавать, что на этот
 * адрес недавно слали код. Экспортируется для периодической очистки в index.ts.
 */
export const emailCodeLimiter = new RateLimiter({
  capacity: 3,
  refillPerSec: 3 / (15 * 60),
});

const AUTH_FIELD_MESSAGES = {
  email: 'Некорректный email',
  code: 'Некорректный код',
} as const;

export function createAppAuthRouter() {
  const auth = new Hono();

  // Пер-IP анти-флуд (это не enumeration — штатный 429 при превышении).
  const requestIpLimit = createIpRateLimit({ capacity: 10, refillPerSec: 10 / 900 });
  const verifyIpLimit = createIpRateLimit({ capacity: 20, refillPerSec: 20 / 900 });

  auth.post(
    '/request-code',
    requestIpLimit,
    validateJson(z.object({ email: z.email() }), AUTH_FIELD_MESSAGES),
    async (c) => {
      const email = normalizeEmail(c.req.valid('json').email);

      // Пер-email лимит: молча 200 без отправки (без user enumeration).
      if (emailCodeLimiter.hit(email).allowed) {
        try {
          const code = generateLoginCode();
          await issueLoginCode(email, hashCode(code));
          // Отправку письма НЕ ждём: SMTP-сбой/задержка не должны держать HTTP-ответ
          // (иначе прокси рвёт на таймауте → 504). Ответ 200 одинаков для любого
          // email (анти-энумерация), так что фон ничего не меняет для клиента.
          void sendLoginCodeEmail(email, code).catch((err: unknown) => {
            console.error('Ошибка отправки кода входа:', err);
          });
        } catch (err) {
          // Ответ не должен зависеть от инфраструктурных сбоев (тайминг/enumeration).
          console.error('Ошибка выпуска кода входа:', err);
        }
      }

      return c.json({ data: { ok: true } });
    },
  );

  auth.post(
    '/verify-code',
    verifyIpLimit,
    validateJson(
      z.object({ email: z.email(), code: z.string().regex(/^\d{6}$/) }),
      AUTH_FIELD_MESSAGES,
    ),
    async (c) => {
      const { email: rawEmail, code } = c.req.valid('json');
      const email = normalizeEmail(rawEmail);

      const ok = await verifyLoginCode(email, hashCode(code));
      if (!ok) {
        return c.json({ error: 'Неверный или просроченный код' }, 400);
      }

      const user = await findOrCreateEmailUser(email);
      // null → identity ведёт на soft-deleted аккаунт. Тот же обобщённый 400, что
      // и при неверном коде: не раскрываем состояние аккаунта и не ставим куку.
      if (!user) {
        return c.json({ error: 'Неверный или просроченный код' }, 400);
      }
      setCookie(c, 'app_token', signAppToken(user.id), {
        ...APP_COOKIE_OPTS,
        maxAge: APP_COOKIE_MAX_AGE,
      });

      return c.json({ data: { user: toAppUser(user) } });
    },
  );

  // Вход через Telegram Login Widget (Этап 7). Публичный, пер-IP анти-флуд.
  // Сходится в те же user_identities, что и вход по коду: identity ('telegram', id)
  // есть → её юзер; нет → getOrCreateTelegramUser. Невалидная подпись/просроченный
  // auth_date → 401. Payload читаем сырым (не через validateJson): data_check_string
  // строится по ВСЕМ присланным полям, а strip неизвестных ключей сломал бы подпись.
  const telegramIpLimit = createIpRateLimit({
    capacity: 20,
    refillPerSec: 20 / 900,
  });

  auth.post('/telegram', telegramIpLimit, async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Некорректные данные Telegram' }, 400);
    }

    const verified = verifyTelegramLogin(body, process.env.BOT_TOKEN ?? '');
    if (!verified.ok) {
      // Причину не раскрываем — единый ответ на любую неудачу проверки.
      return c.json({ error: 'Не удалось войти через Telegram' }, 401);
    }
    const tg = verified.data;

    const identity = await db.query.userIdentities.findFirst({
      where: and(
        eq(userIdentities.provider, 'telegram'),
        eq(userIdentities.providerId, tg.id),
      ),
    });

    let user;
    if (identity) {
      user = await db.query.users.findFirst({
        where: eq(users.id, identity.userId),
      });
    } else {
      user = await getOrCreateTelegramUser(tg.id, {
        username: tg.username ?? tg.firstName,
        name: tg.firstName,
        surname: tg.lastName,
      });
    }

    // Паритет с email-входом: identity на soft-deleted аккаунт (теоретически —
    // anonymize удаляет identity) → отказ без куки.
    if (!user) {
      return c.json({ error: 'Не удалось войти через Telegram' }, 401);
    }
    if (user.deletedAt !== null) {
      return c.json({ error: 'Не удалось войти через Telegram' }, 401);
    }

    setCookie(c, 'app_token', signAppToken(user.id), {
      ...APP_COOKIE_OPTS,
      maxAge: APP_COOKIE_MAX_AGE,
    });

    return c.json({ data: { user: toAppUser(user) } });
  });

  auth.post('/logout', (c) => {
    deleteCookie(c, 'app_token', APP_COOKIE_OPTS);
    return c.json({ data: { ok: true } });
  });

  auth.get('/me', requireUser, (c) =>
    c.json({ data: { user: toAppUser(c.get('appUser')) } }),
  );

  return auth;
}
