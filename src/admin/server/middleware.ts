import { createMiddleware } from 'hono/factory';
import { eq } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import { users } from '@/db/schema.js';

export interface AdminUser {
  id: UUID;
  username: string;
  role: string;
}

declare module 'hono' {
  interface ContextVariableMap {
    adminUser: AdminUser;
  }
}

const rawJwtSecret = process.env.JWT_SECRET;
if (!rawJwtSecret) {
  throw new Error('JWT_SECRET environment variable is required');
}
export const JWT_SECRET = rawJwtSecret;

export function signToken(payload: AdminUser): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
}

export const requireAdmin = createMiddleware(async (c, next) => {
  const cookie = c.req.header('Cookie') ?? '';
  const tokenMatch = /admin_token=([^;]+)/.exec(cookie);
  const token = tokenMatch?.[1];

  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as AdminUser;

    // Re-verify role in DB on each request
    const user = await db.query.users.findFirst({
      where: eq(users.id, payload.id),
    });

    if (user?.role !== 'admin') {
      return c.json({ error: 'Forbidden' }, 403);
    }

    c.set('adminUser', {
      id: user.id,
      username: user.username,
      role: user.role,
    });

    await next();
  } catch {
    return c.json({ error: 'Invalid token' }, 401);
  }
});
