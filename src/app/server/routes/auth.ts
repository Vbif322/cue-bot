import type { UUID } from 'crypto';
import { Hono } from 'hono';
import type { Context } from 'hono';
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
  mergeAccountIntoTelegram,
  MergeError,
  linkEmailToUser,
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
import { verifyMiniAppInitData } from '../telegramMiniApp.js';
import type { TelegramClaims } from '../telegramClaims.js';
import type { DbUser } from '@/bot/types.js';
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

// Подписанная кука «намерения слияния»: выставляется в OIDC-callback, когда
// привязываемый Telegram уже занят ДРУГИМ активным аккаунтом, и подтверждается
// отдельным POST /telegram/merge. Хранит доказанную через OIDC связку survivor↔losing,
// поэтому подписана JWT_SECRET и живёт коротко. Читается ещё и в /api/app/me (показ
// карточки слияния) — отсюда экспорт имени/парсера.
export const MERGE_COOKIE = 'tg_merge';
const MERGE_COOKIE_MAX_AGE = 10 * 60; // 10 минут на подтверждение

export interface MergeIntent {
  /** Аккаунт-survivor — владелец Telegram (в него сливаем). */
  survivorUserId: UUID;
  /** Аккаунт-losing — текущая (email) сессия, будет поглощён. */
  losingUserId: UUID;
  telegramId: string;
}

/** Читает и валидирует подписанную куку {@link MERGE_COOKIE}; `null`, если её нет/битая. */
export async function readMergeIntent(c: Context): Promise<MergeIntent | null> {
  const raw = await getSignedCookie(c, JWT_SECRET, MERGE_COOKIE);
  if (!raw) return null; // нет куки или подпись не сошлась
  try {
    const { survivorUserId, losingUserId, telegramId } = JSON.parse(
      raw,
    ) as Partial<MergeIntent>;
    if (!survivorUserId || !losingUserId || !telegramId) return null;
    return { survivorUserId, losingUserId, telegramId };
  } catch {
    return null;
  }
}

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
interface LinkResult {
  status: 'linked' | 'exists' | 'has_other' | 'error';
  /** Владелец Telegram при status='exists' — кандидат в survivor для слияния. */
  survivorUserId?: UUID;
}

async function linkTelegram(
  userId: UUID | null,
  telegramId: string,
): Promise<LinkResult> {
  if (!userId) return { status: 'error' };
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (user?.deletedAt !== null) return { status: 'error' };

  const existing = await db.query.userIdentities.findFirst({
    where: and(
      eq(userIdentities.provider, 'telegram'),
      eq(userIdentities.providerId, telegramId),
    ),
  });
  if (existing) {
    // Свой — идемпотентно; чужой → кандидат на слияние (см. callback).
    return existing.userId === userId
      ? { status: 'linked' }
      : { status: 'exists', survivorUserId: existing.userId };
  }

  const ownTelegram = await db.query.userIdentities.findFirst({
    where: and(
      eq(userIdentities.userId, userId),
      eq(userIdentities.provider, 'telegram'),
    ),
  });
  if (ownTelegram) return { status: 'has_other' };

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

  return { status: 'linked' };
}

/**
 * Резолвит вошедшего через Telegram пользователя (общий код для OIDC-callback и
 * Mini App): identity ('telegram', id) есть → её юзер; нет → getOrCreateTelegramUser.
 * Возвращает `null`, если identity ведёт на soft-deleted аккаунт (паритет с email-входом).
 */
async function loginTelegramUser(claims: TelegramClaims): Promise<DbUser | null> {
  const identity = await db.query.userIdentities.findFirst({
    where: and(
      eq(userIdentities.provider, 'telegram'),
      eq(userIdentities.providerId, claims.id),
    ),
  });

  let user: DbUser | undefined;
  if (identity) {
    user = await db.query.users.findFirst({
      where: eq(users.id, identity.userId),
    });
  } else {
    user = await getOrCreateTelegramUser(claims.id, {
      username: claims.username ?? claims.firstName,
      name: claims.firstName,
      surname: claims.surname,
    });
  }

  if (user?.deletedAt !== null) return null;
  return user;
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

  // ── Привязка email к УЖЕ вошедшему аккаунту (обычно — Telegram-only) ─────────
  // Зеркало входа по коду, но за requireUser и с записью identity на текущего юзера,
  // а не поиском/созданием аккаунта. Два шага: запросить код на адрес → подтвердить.

  auth.post(
    '/email/request-code',
    requireUser,
    verifyIpLimit,
    validateJson(z.object({ email: z.email() }), AUTH_FIELD_MESSAGES),
    async (c) => {
      const user = c.get('appUser');
      const email = normalizeEmail(c.req.valid('json').email);

      // Пользователь аутентифицирован — enumeration не проблема, поэтому даём
      // ранние понятные ошибки вместо «молчаливого 200» логина.
      const own = await db.query.userIdentities.findFirst({
        where: and(
          eq(userIdentities.userId, user.id),
          eq(userIdentities.provider, 'email'),
        ),
      });
      if (own) {
        return c.json(
          {
            error:
              own.providerId === email
                ? 'Эта почта уже привязана.'
                : 'К аккаунту уже привязана другая почта.',
          },
          400,
        );
      }
      const taken = await db.query.userIdentities.findFirst({
        where: and(
          eq(userIdentities.provider, 'email'),
          eq(userIdentities.providerId, email),
        ),
      });
      if (taken) {
        return c.json(
          { error: 'Эта почта уже используется другим аккаунтом.' },
          400,
        );
      }

      // Пер-email лимит (общий бакет с логином): молча пропускаем без отправки.
      if (emailCodeLimiter.hit(email).allowed) {
        try {
          const code = generateLoginCode();
          await issueLoginCode(email, hashCode(code));
          void sendLoginCodeEmail(email, code).catch((err: unknown) => {
            console.error('Ошибка отправки кода привязки email:', err);
          });
        } catch (err) {
          console.error('Ошибка выпуска кода привязки email:', err);
        }
      }

      return c.json({ data: { ok: true } });
    },
  );

  auth.post(
    '/email/verify',
    requireUser,
    verifyIpLimit,
    validateJson(
      z.object({ email: z.email(), code: z.string().regex(/^\d{6}$/) }),
      AUTH_FIELD_MESSAGES,
    ),
    async (c) => {
      const user = c.get('appUser');
      const { email: rawEmail, code } = c.req.valid('json');
      const email = normalizeEmail(rawEmail);

      const ok = await verifyLoginCode(email, hashCode(code));
      if (!ok) {
        return c.json({ error: 'Неверный или просроченный код' }, 400);
      }

      try {
        const result = await linkEmailToUser(user.id, email);
        if (result === 'has_other') {
          return c.json({ error: 'К аккаунту уже привязана другая почта.' }, 400);
        }
        if (result === 'exists') {
          return c.json(
            { error: 'Эта почта уже используется другим аккаунтом.' },
            400,
          );
        }
        const updated = await db.query.users.findFirst({
          where: eq(users.id, user.id),
        });
        if (!updated) {
          return c.json({ error: 'Аккаунт недоступен.' }, 400);
        }
        return c.json({ data: { user: toAppUser(updated) } });
      } catch (err) {
        // Редкая гонка на UNIQUE — код уже погашен, просим повторить.
        console.error('Ошибка привязки email:', err);
        return c.json(
          { error: 'Не удалось привязать почту. Попробуйте ещё раз.' },
          400,
        );
      }
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
      // Cookie-only (без Bearer): это браузерный редирект-флоу, заголовков тут нет.
      const user = await resolveUserFromCookie(c, { cookie: 'app_token', typ: 'app' });
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
      // Telegram занят ДРУГИМ активным аккаунтом → предлагаем слить текущий (email)
      // в него. Доказательство владения обоими (сессия + OIDC) фиксируем в подписанной
      // куке, само слияние — только по явному POST /telegram/merge.
      if (result.status === 'exists' && result.survivorUserId && flow.userId) {
        const survivor = await db.query.users.findFirst({
          where: eq(users.id, result.survivorUserId),
        });
        if (survivor?.deletedAt === null) {
          await setSignedCookie(
            c,
            MERGE_COOKIE,
            JSON.stringify({
              survivorUserId: result.survivorUserId,
              losingUserId: flow.userId,
              telegramId: claims.id,
            }),
            JWT_SECRET,
            { ...OAUTH_COOKIE_OPTS, maxAge: MERGE_COOKIE_MAX_AGE },
          );
          return c.redirect('/profile?telegram=merge_available');
        }
      }
      return c.redirect(`/profile?telegram=${result.status}`);
    }

    // Вход: сходится в те же user_identities, что и вход по коду/Mini App.
    const user = await loginTelegramUser(claims);
    if (!user) return failRedirect('error');

    setCookie(c, 'app_token', signAppToken(user.id), {
      ...APP_COOKIE_OPTS,
      maxAge: APP_COOKIE_MAX_AGE,
    });
    return c.redirect('/');
  });

  // Авто-вход из Telegram Mini App: фронт шлёт `initData` (window.Telegram.WebApp),
  // проверяем Ed25519-подпись Telegram и заводим ту же сессию, что OIDC/код. В отличие
  // от OIDC это обычный JSON-эндпоинт (не редирект): вызывается fetch'ем на старте app/.
  // Rate-limit отдельный от OIDC: авто-вход массовый (каждое открытие Mini App), и за
  // CGNAT много пользователей делят один IP — общий bucket выбивал бы их из входа.
  const miniAppIpLimit = createIpRateLimit({
    capacity: 60,
    refillPerSec: 60 / 900,
  });

  auth.post(
    '/telegram/miniapp',
    miniAppIpLimit,
    validateJson(
      z.object({ initData: z.string().min(1) }),
      { initData: 'Некорректные данные Telegram' },
    ),
    async (c) => {
      const { initData } = c.req.valid('json');

      const botId = (process.env.BOT_TOKEN ?? '').split(':')[0] ?? '';
      const verified = verifyMiniAppInitData(initData, botId);
      if (!verified.ok) {
        console.warn('Telegram Mini App login rejected:', verified.reason);
        return c.json({ error: 'Не удалось войти через Telegram' }, 401);
      }

      const user = await loginTelegramUser(verified.data);
      if (!user) return c.json({ error: 'Не удалось войти через Telegram' }, 401);

      // Куку ставим (для браузера), НО в WebView Telegram куки ненадёжны — поэтому
      // дополнительно отдаём токен в теле. Фронт хранит его и шлёт в заголовке
      // Authorization: Bearer (см. apiFetch); requireUser принимает и куку, и заголовок.
      // Bearer-токен КОРОЧЕ куки (24ч против 30д): он читаем из JS (XSS-риск) и не
      // отзываем; перевыпуск в Mini App прозрачен — initData всегда под рукой.
      setCookie(c, 'app_token', signAppToken(user.id), {
        ...APP_COOKIE_OPTS,
        maxAge: APP_COOKIE_MAX_AGE,
      });
      const token = signAppToken(user.id, '24h');
      return c.json({ data: { user: toAppUser(user), token } });
    },
  );

  // Подтверждение слияния текущего (email) аккаунта в Telegram-аккаунт. Триггерится
  // из /profile после того, как callback выставил куку tg_merge (Telegram занят другим
  // аккаунтом). Требует активной сессии losing-аккаунта; проверяем, что кука относится
  // к ней и Telegram всё ещё за survivor, затем сливаем и ПЕРЕВЫПУСКАЕМ сессию на survivor.
  auth.post('/telegram/merge', requireUser, async (c) => {
    const intent = await readMergeIntent(c);
    deleteCookie(c, MERGE_COOKIE, OAUTH_COOKIE_OPTS); // одноразовая
    const sessionUser = c.get('appUser');

    if (!intent) {
      return c.json({ error: 'Слияние недоступно или устарело.' }, 400);
    }
    if (intent.losingUserId !== sessionUser.id) {
      return c.json({ error: 'Слияние недоступно или устарело.' }, 400);
    }

    // Telegram всё ещё должен принадлежать заявленному survivor (мог отвязаться).
    const identity = await db.query.userIdentities.findFirst({
      where: and(
        eq(userIdentities.provider, 'telegram'),
        eq(userIdentities.providerId, intent.telegramId),
      ),
    });
    if (identity?.userId !== intent.survivorUserId) {
      return c.json({ error: 'Слияние недоступно или устарело.' }, 400);
    }

    try {
      const survivor = await mergeAccountIntoTelegram(
        intent.survivorUserId,
        intent.losingUserId,
      );
      // survivor.id ≠ прежней сессии — перевыпускаем куку, иначе она указывала бы
      // на тумбстон losing-аккаунта.
      setCookie(c, 'app_token', signAppToken(survivor.id), {
        ...APP_COOKIE_OPTS,
        maxAge: APP_COOKIE_MAX_AGE,
      });
      return c.json({ data: { user: toAppUser(survivor) } });
    } catch (e) {
      if (e instanceof MergeError) return c.json({ error: e.message }, 400);
      throw e;
    }
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
