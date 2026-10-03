import { Hono } from 'hono';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { setCookie, deleteCookie } from 'hono/cookie';
import { and, eq, gt } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { db } from '../../db/db.js';
import { users, loginTokens } from '../../db/schema.js';
import { signToken, JWT_SECRET, type AdminUser } from './middleware.js';
import { createIpRateLimit, resolveClientIp } from './middleware/rateLimit.js';
import { findActiveEmailUser } from '../../services/userService.js';
import {
  issueLoginCode,
  verifyLoginCode,
} from '../../services/emailLoginCodeService.js';
import { sendLoginCodeEmail } from '../../services/mailService.js';
import {
  generateLoginCode,
  hashCode,
  normalizeEmail,
} from '../../app/server/authCrypto.js';
import { emailCodeLimiter } from '../../app/server/routes/auth.js';
import { validateJson } from '../../app/server/routes/_shared.js';

// Secure-флаг ставим только в production: на http://localhost браузер иначе
// молча отбросил бы cookie в dev. SameSite=Lax (не Strict): Strict-куку браузер не
// шлёт при межсайтовых top-level переходах (напр. переход по /dashboard-ссылке из
// Telegram), из-за чего только что установленная сессия выглядит «потерянной»; на
// кросс-сайтовых POST Lax не отправляется, так что CSRF-защита мутаций сохраняется.
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'Lax',
  path: '/',
} as const;

// admin_token must only ever be set on the admin host (ADMIN_BASE_URL): the whole
// admin API is also served on the public player host, so a cookie there would let an
// XSS in the player SPA act as admin. Returns the admin base URL when this request
// arrived on a different host in production, otherwise undefined. Env is read per
// call (not at import) so tests can stub it; ADMIN_BASE_URL's presence in production
// is enforced at startup in src/index.ts.
function foreignHostAdminBase(c: Context): string | undefined {
  const adminBaseUrl = process.env.ADMIN_BASE_URL;
  if (process.env.NODE_ENV !== 'production' || !adminBaseUrl) return undefined;
  return c.req.header('host') === new URL(adminBaseUrl).host
    ? undefined
    : adminBaseUrl;
}

const ADMIN_SESSION_MAX_AGE = 24 * 60 * 60; // совпадает с expiresIn в signToken

/** Выдаёт админскую сессию: JWT `typ:'admin'` в HttpOnly-куке `admin_token`. */
function setAdminSession(
  c: Context,
  user: { id: AdminUser['id']; username: string; role: string },
): void {
  const token = signToken({
    id: user.id,
    username: user.username,
    role: user.role,
  });
  setCookie(c, 'admin_token', token, {
    ...COOKIE_OPTS,
    maxAge: ADMIN_SESSION_MAX_AGE,
  });
}

const INVALID_CODE = 'Неверный или просроченный код';

const AUTH_FIELD_MESSAGES = {
  email: 'Некорректный email',
  code: 'Некорректный код',
} as const;

// Адрес сайта игрока для ссылки «Сайт игрока» в админке. В dev — всегда Vite-сервер
// app/ (:5174): PUBLIC_BASE_URL там указывает на HTTPS-туннель для вебхука/web_app.
const playerUrl =
  process.env.NODE_ENV === 'production' && process.env.PUBLIC_BASE_URL
    ? process.env.PUBLIC_BASE_URL
    : 'http://localhost:5174';

export function createAuthRouter() {
  const auth = new Hono();

  // Throttle token redemption per IP (10/min) to blunt brute-force / abuse of the
  // login link. On overflow redirect to the login page rather than a bare 429, to
  // match the route's existing auth-redirect UX.
  const tokenRateLimit = createIpRateLimit({
    capacity: 10,
    refillPerSec: 10 / 60,
    onLimit: (c) => c.redirect('/login?error=ratelimit'),
  });

  auth.get('/token', tokenRateLimit, async (c) => {
    // Legacy "Открыть панель" buttons in chat history point at PUBLIC_BASE_URL.
    // Bounce them to the admin subdomain BEFORE spending the one-time token, so the
    // admin_token cookie lands on the admin host. Prod-only: in dev the token comes
    // in on localhost and must not be redirected to the domain.
    const adminBaseUrl = foreignHostAdminBase(c);
    if (adminBaseUrl) {
      const u = new URL(c.req.url);
      return c.redirect(`${adminBaseUrl}${u.pathname}${u.search}`, 302);
    }

    const t = c.req.query('t');
    if (!t) {
      return c.redirect('/login?error=invalid');
    }

    const record = await db.query.loginTokens.findFirst({
      where: and(
        eq(loginTokens.token, t),
        gt(loginTokens.expiresAt, new Date()),
      ),
    });
    if (!record) {
      return c.redirect('/login?error=invalid');
    }

    await db.delete(loginTokens).where(eq(loginTokens.token, t));

    const user = await db.query.users.findFirst({
      where: eq(users.id, record.userId),
    });

    if (user?.role !== 'admin') return c.redirect('/login?error=forbidden');

    setAdminSession(c, user);
    return c.redirect('/');
  });

  // ── Вход по коду на почту (как на сайте игрока) ─────────────────────────────
  // Коды и пер-email лимит общие с /api/app/auth: адрес один и тот же человек, а
  // админ с почтой и так попадает сюда через сайт игрока → «Админка». Код выдаём
  // для ЛЮБОГО адреса (без проверки роли): иначе по времени ответа вычислялись бы
  // почты админов. Роль проверяется в verify-code, после доказанного владения адресом.

  // Оба маршрута ставят/готовят admin_token — только на admin-хосте (см. выше).
  const adminHostOnly = createMiddleware(async (c, next) => {
    if (foreignHostAdminBase(c)) return c.json({ error: 'Not found' }, 404);
    await next();
  });

  // Пер-IP анти-флуд, те же значения, что у игрока.
  const requestIpLimit = createIpRateLimit({
    capacity: 10,
    refillPerSec: 10 / 900,
  });
  const verifyIpLimit = createIpRateLimit({
    capacity: 20,
    refillPerSec: 20 / 900,
  });

  auth.post(
    '/request-code',
    adminHostOnly,
    requestIpLimit,
    validateJson(z.object({ email: z.email() }), AUTH_FIELD_MESSAGES),
    async (c) => {
      const email = normalizeEmail(c.req.valid('json').email);

      // Пер-email лимит: молча 200 без отправки (без user enumeration).
      if (emailCodeLimiter.hit(email).allowed) {
        try {
          const code = generateLoginCode();
          await issueLoginCode(email, hashCode(code));
          // Письмо не ждём: SMTP-задержка не должна держать HTTP-ответ.
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
    adminHostOnly,
    verifyIpLimit,
    validateJson(
      z.object({ email: z.email(), code: z.string().regex(/^\d{6}$/) }),
      AUTH_FIELD_MESSAGES,
    ),
    async (c) => {
      const { email: rawEmail, code } = c.req.valid('json');
      const email = normalizeEmail(rawEmail);

      if (!(await verifyLoginCode(email, hashCode(code)))) {
        return c.json({ error: INVALID_CODE }, 400);
      }

      // Пользователя НЕ создаём. Нет подтверждённой identity / аккаунт удалён —
      // тот же обобщённый 400, что и при неверном коде.
      const user = await findActiveEmailUser(email);
      if (!user) return c.json({ error: INVALID_CODE }, 400);

      // Владение адресом уже доказано кодом — отсутствие прав можно назвать прямо.
      if (user.role !== 'admin') {
        return c.json(
          { error: 'У этого аккаунта нет прав администратора' },
          403,
        );
      }

      setAdminSession(c, user);
      console.info(
        `Вход в админку по почте: user=${user.id} ip=${resolveClientIp(c, 1)}`,
      );
      return c.json({
        data: {
          user: { id: user.id, username: user.username, role: user.role },
        },
      });
    },
  );

  auth.post('/logout', (c) => {
    deleteCookie(c, 'admin_token', COOKIE_OPTS);
    return c.json({ ok: true });
  });

  auth.get('/me', async (c) => {
    const cookie = c.req.header('Cookie') ?? '';
    const tokenMatch = /admin_token=([^;]+)/.exec(cookie);
    const token = tokenMatch?.[1];

    if (!token) {
      return c.json({ user: null, playerUrl });
    }
    try {
      const payload = jwt.verify(token, JWT_SECRET) as AdminUser;

      const user = await db.query.users.findFirst({
        where: eq(users.id, payload.id),
      });

      if (user?.role !== 'admin') {
        return c.json({ user: null, playerUrl });
      }

      return c.json({
        user: { id: user.id, username: user.username, role: user.role },
        playerUrl,
      });
    } catch {
      return c.json({ user: null, playerUrl });
    }
  });

  return auth;
}
