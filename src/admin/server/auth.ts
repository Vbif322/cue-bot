import { Hono } from 'hono';
import { and, eq, gt } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import { db } from '../../db/db.js';
import { users, loginTokens } from '../../db/schema.js';
import { signToken, JWT_SECRET, type AdminUser } from './middleware.js';

export function createAuthRouter() {
  const auth = new Hono();

  auth.get('/token', async (c) => {
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
    c.header(
      'Set-Cookie',
      `admin_token=${token}; HttpOnly; Path=/; Max-Age=${String(24 * 60 * 60)}; SameSite=Strict`,
    );
    return c.redirect('/');
  });

  auth.post('/logout', (c) => {
    c.header(
      'Set-Cookie',
      'admin_token=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict',
    );
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
