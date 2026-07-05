import type { UUID } from 'crypto';
import { Hono } from 'hono';
import {
  setCookie,
  deleteCookie,
  setSignedCookie,
  getSignedCookie,
} from 'hono/cookie';
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db/db.js';
import { userIdentities, users } from '@/db/schema.js';
import { RateLimiter } from '@/lib/rateLimiter.js';
import { createIpRateLimit } from '@/admin/server/middleware/rateLimit.js';
import {
  requireUser,
  signAppToken,
  resolveUserFromCookie,
  JWT_SECRET,
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
import {
  createPkce,
  createState,
  buildAuthUrl,
  exchangeCode,
  verifyIdToken,
  redirectUri,
  type TelegramOidcClaims,
} from '../telegramOidc.js';
import {
  generateLoginCode,
  hashCode,
  normalizeEmail,
} from '../authCrypto.js';
import { validateJson } from './_shared.js';

const APP_COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 дней

// Secure-флаг только в проде: на http://localhost браузер иначе отбросит куку в dev.
// SameSite=Lax (не Strict): Strict-куку браузер не шлёт при межсайтовых top-level
// переходах (заход по ссылке из Telegram, возврат из OAuth-попапа), из-за чего только
// что установленная сессия выглядит «потерянной». Lax это чинит и по-прежнему не
// отправляется на кросс-сайтовых POST — CSRF-защита мутаций сохраняется.
const APP_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'Lax',
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

/**
 * Привязка Telegram к аккаунту `userId` (OIDC-возврат, intent='link'). Инварианты
 * те же, что раньше в POST /api/app/me/telegram: этот Telegram свободен и у аккаунта
 * ещё нет своего Telegram. Возвращает код статуса для query-параметра редиректа:
 * 'linked' | 'exists' (Telegram уже за другим) | 'has_other' (у аккаунта уже есть) |
 * 'error' (сессия истекла/аккаунт исчез).
 */
async function linkTelegram(
  userId: UUID | null,
  telegramId: string,
): Promise<'linked' | 'exists' | 'has_other' | 'error'> {
  if (!userId) return 'error';
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (user?.deletedAt !== null) return 'error';

  const existing = await db.query.userIdentities.findFirst({
    where: and(
      eq(userIdentities.provider, 'telegram'),
      eq(userIdentities.providerId, telegramId),
    ),
  });
  if (existing) {
    return existing.userId === userId ? 'linked' : 'exists'; // свой — идемпотентно
  }

  const ownTelegram = await db.query.userIdentities.findFirst({
    where: and(
      eq(userIdentities.userId, userId),
      eq(userIdentities.provider, 'telegram'),
    ),
  });
  if (ownTelegram) return 'has_other';

  // Вставляем identity и заполняем users.telegram_id, если он пуст — после этого
  // юзеру доставляются Telegram-уведомления (инвариант бота).
  await db.transaction(async (tx) => {
    await tx
      .insert(userIdentities)
      .values({ userId, provider: 'telegram', providerId: telegramId })
      .onConflictDoNothing({
        target: [userIdentities.provider, userIdentities.providerId],
      });
    await tx
      .update(users)
      .set({ telegram_id: telegramId })
      .where(and(eq(users.id, userId), isNull(users.telegram_id)));
  });

  return 'linked';
}

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

  // Вход/привязка через Telegram по OIDC (Authorization Code Flow + PKCE). Два
  // редирект-эндпоинта вместо прежнего POST с HMAC-подписью виджета:
  //   GET /telegram/start[?link=1]  — заводит PKCE+state, редиректит на oauth.telegram.org
  //   GET /telegram/callback        — обменивает code на id_token, ставит сессию/привязку
  // state/verifier/intent храним в короткоживущей ПОДПИСАННОЙ куке tg_oauth (переживает
  // рестарт, без общего стора). SameSite=Lax: кука едет на top-level GET-возврате из
  // Telegram. Пер-IP анти-флуд на оба шага.
  const telegramIpLimit = createIpRateLimit({
    capacity: 20,
    refillPerSec: 20 / 900,
  });

  // Кука с параметрами OIDC-потока: живёт до возврата из Telegram.
  const OAUTH_COOKIE = 'tg_oauth';
  const OAUTH_COOKIE_MAX_AGE = 10 * 60; // 10 минут на прохождение согласия
  const OAUTH_COOKIE_OPTS = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    path: '/',
  } as const;

  auth.get('/telegram/start', telegramIpLimit, async (c) => {
    const link = c.req.query('link') === '1';

    // Привязка требует уже вошедшего пользователя — фиксируем его id в куке, чтобы
    // callback знал, к какому аккаунту цеплять Telegram (сессии в куке нет смысла
    // перечитывать в callback — там мы вернёмся тем же браузером).
    let userId: string | null = null;
    if (link) {
      const user = await resolveUserFromCookie(c, 'app_token');
      if (!user) return c.redirect('/login?telegram=auth_required');
      userId = user.id;
    }

    const state = createState();
    const { codeVerifier, codeChallenge } = createPkce();

    await setSignedCookie(
      c,
      OAUTH_COOKIE,
      JSON.stringify({ state, codeVerifier, intent: link ? 'link' : 'login', userId }),
      JWT_SECRET,
      { ...OAUTH_COOKIE_OPTS, maxAge: OAUTH_COOKIE_MAX_AGE },
    );

    let url: string;
    try {
      url = buildAuthUrl({ state, codeChallenge, redirectUri: redirectUri() });
    } catch (err) {
      console.error('Telegram OIDC start failed:', err);
      return c.redirect(link ? '/profile?telegram=error' : '/login?telegram=error');
    }
    return c.redirect(url);
  });

  auth.get('/telegram/callback', telegramIpLimit, async (c) => {
    // Разбираем куку потока и сразу её гасим (одноразовая).
    const raw = await getSignedCookie(c, JWT_SECRET, OAUTH_COOKIE);
    deleteCookie(c, OAUTH_COOKIE, OAUTH_COOKIE_OPTS);

    // getSignedCookie → false при битой подписи, undefined если куки нет.
    if (!raw) return c.redirect('/login?telegram=error');
    let flow: {
      state: string;
      codeVerifier: string;
      intent: string;
      userId: UUID | null;
    };
    try {
      flow = JSON.parse(raw) as typeof flow;
    } catch {
      return c.redirect('/login?telegram=error');
    }
    const isLink = flow.intent === 'link';
    const failRedirect = (code: string): Response =>
      c.redirect(`${isLink ? '/profile' : '/login'}?telegram=${code}`);

    // Пользователь отменил согласие или Telegram вернул ошибку.
    if (c.req.query('error')) return failRedirect('cancelled');

    const code = c.req.query('code');
    const state = c.req.query('state');
    if (!code || !state || state !== flow.state) {
      console.warn('Telegram OIDC callback: state/code mismatch');
      return failRedirect('error');
    }

    let claims: TelegramOidcClaims;
    try {
      const idToken = await exchangeCode({
        code,
        codeVerifier: flow.codeVerifier,
        redirectUri: redirectUri(),
      });
      const verified = verifyIdToken(idToken);
      if (!verified.ok) {
        console.warn('Telegram OIDC id_token rejected:', verified.reason);
        return failRedirect('error');
      }
      claims = verified.data;
    } catch (err) {
      console.warn('Telegram OIDC token exchange failed:', err);
      return failRedirect('error');
    }

    if (isLink) {
      const result = await linkTelegram(flow.userId, claims.id);
      return c.redirect(`/profile?telegram=${result}`);
    }

    // Вход: сходится в те же user_identities, что и вход по коду.
    const identity = await db.query.userIdentities.findFirst({
      where: and(
        eq(userIdentities.provider, 'telegram'),
        eq(userIdentities.providerId, claims.id),
      ),
    });

    let user;
    if (identity) {
      user = await db.query.users.findFirst({
        where: eq(users.id, identity.userId),
      });
    } else {
      user = await getOrCreateTelegramUser(claims.id, {
        username: claims.username ?? claims.firstName,
        name: claims.firstName,
      });
    }

    // Паритет с email-входом: identity на soft-deleted аккаунт → отказ без куки.
    if (user?.deletedAt !== null) return failRedirect('error');

    setCookie(c, 'app_token', signAppToken(user.id), {
      ...APP_COOKIE_OPTS,
      maxAge: APP_COOKIE_MAX_AGE,
    });
    return c.redirect('/');
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
