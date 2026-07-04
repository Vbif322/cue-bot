import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import { and, eq, gt } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import { db } from '../../db/db.js';
import { users, loginTokens } from '../../db/schema.js';
import { signToken, JWT_SECRET, type AdminUser } from './middleware.js';
import { createIpRateLimit } from './middleware/rateLimit.js';

// Secure-флаг ставим только в production: на http://localhost браузер иначе
// молча отбросил бы cookie в dev.
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'Strict',
  path: '/',
} as const;

// Admin host, derived from ADMIN_BASE_URL — used to redirect the legacy /dashboard
// button (which pointed at PUBLIC_BASE_URL) onto the admin subdomain before the
// login token is spent, so the admin_token cookie is set on the admin host. Only
// consulted by the prod-gated shim below; ADMIN_BASE_URL's presence in production is
// enforced at startup in src/index.ts.
const adminBaseUrl = process.env.ADMIN_BASE_URL;
const adminHost = adminBaseUrl ? new URL(adminBaseUrl).host : undefined;

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
    // in on localhost (host !== adminHost) and must not be redirected to the domain.
    if (
      process.env.NODE_ENV === 'production' &&
      adminBaseUrl &&
      c.req.header('host') !== adminHost
    ) {
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

    if (user?.role !== 'admin')
      return c.redirect('/login?error=forbidden');

    const token = signToken({
      id: user.id,
      username: user.username,
      role: user.role,
    });
    setCookie(c, 'admin_token', token, {
      ...COOKIE_OPTS,
      maxAge: 24 * 60 * 60,
    });
    return c.redirect('/');
  });

  auth.post('/logout', (c) => {
    deleteCookie(c, 'admin_token', COOKIE_OPTS);
    return c.json({ ok: true });
  });

  auth.get('/me', async (c) => {
    const cookie = c.req.header('Cookie') ?? '';
    const tokenMatch = /admin_token=([^;]+)/.exec(cookie);
    const token = tokenMatch?.[1];

    if (!token) {
      return c.json({ user: null });
    }
    try {
      const payload = jwt.verify(token, JWT_SECRET) as AdminUser;

      const user = await db.query.users.findFirst({
        where: eq(users.id, payload.id),
      });

      if (user?.role !== 'admin') {
        return c.json({ user: null });
      }

      return c.json({
        user: { id: user.id, username: user.username, role: user.role },
      });
    } catch {
      return c.json({ user: null });
    }
  });

  return auth;
}
