import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { RateLimiter } from '@/lib/rateLimiter.js';
import { createIpRateLimit } from '@/admin/server/middleware/rateLimit.js';
import {
  requireUser,
  signAppToken,
} from '@/admin/server/middleware.js';
import { findOrCreateEmailUser, toAppUser } from '@/services/userService.js';
import {
  issueLoginCode,
  verifyLoginCode,
} from '@/services/emailLoginCodeService.js';
import { sendLoginCodeEmail } from '@/services/mailService.js';
import {
  generateLoginCode,
  hashCode,
  normalizeEmail,
} from '../authCrypto.js';

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

/**
 * `zValidator('json', …)` с единым конвертом ошибок: на невалидный ввод отдаёт
 * `400 { error: '<по-русски>' }` вместо сырого ZodError (это и утечка внутренних
 * regex, и рассинхрон с остальными ответами `{data}`/`{error}`). Тип `valid('json')`
 * сохраняется — hook лишь перехватывает провал валидации.
 */
function validateJson<T extends z.ZodType>(schema: T) {
  return zValidator('json', schema, (result, c) => {
    if (!result.success) {
      const field = result.error.issues[0]?.path[0];
      const message =
        field === 'email'
          ? 'Некорректный email'
          : field === 'code'
            ? 'Некорректный код'
            : 'Некорректные данные запроса';
      return c.json({ error: message }, 400);
    }
  });
}

export function createAppAuthRouter() {
  const auth = new Hono();

  // Пер-IP анти-флуд (это не enumeration — штатный 429 при превышении).
  const requestIpLimit = createIpRateLimit({ capacity: 10, refillPerSec: 10 / 900 });
  const verifyIpLimit = createIpRateLimit({ capacity: 20, refillPerSec: 20 / 900 });

  auth.post(
    '/request-code',
    requestIpLimit,
    validateJson(z.object({ email: z.email() })),
    async (c) => {
      const email = normalizeEmail(c.req.valid('json').email);

      // Пер-email лимит: молча 200 без отправки (без user enumeration).
      if (emailCodeLimiter.hit(email).allowed) {
        try {
          const code = generateLoginCode();
          await issueLoginCode(email, hashCode(code));
          await sendLoginCodeEmail(email, code);
        } catch (err) {
          // Ответ не должен зависеть от инфраструктурных сбоев (тайминг/enumeration).
          console.error('Ошибка отправки кода входа:', err);
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

  auth.post('/logout', (c) => {
    deleteCookie(c, 'app_token', APP_COOKIE_OPTS);
    return c.json({ data: { ok: true } });
  });

  auth.get('/me', requireUser, (c) =>
    c.json({ data: { user: toAppUser(c.get('appUser')) } }),
  );

  return auth;
}
