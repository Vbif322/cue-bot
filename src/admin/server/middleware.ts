import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import { eq } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import { users } from '@/db/schema.js';
import type { DbUser } from '@/bot/types.js';

export interface AdminUser {
  id: UUID;
  username: string;
  role: string;
}

declare module 'hono' {
  interface ContextVariableMap {
    adminUser: AdminUser;
    appUser: DbUser;
  }
}

const rawJwtSecret = process.env.JWT_SECRET;
if (!rawJwtSecret) {
  throw new Error('JWT_SECRET environment variable is required');
}
export const JWT_SECRET = rawJwtSecret;

/** Admin JWT — прежний формат (payload с ролью), для обратной совместимости кук. */
export function signToken(payload: AdminUser): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
}

/** App JWT игрока — минимальный payload `{ id }`, 30 дней. */
export function signAppToken(id: UUID): string {
  return jwt.sign({ id }, JWT_SECRET, { expiresIn: '30d' });
}

/**
 * Общий разбор куки в живого пользователя: читает JWT из куки `cookieName`,
 * верифицирует подпись, перечитывает `users` из БД по `id` и возвращает строку
 * только если аккаунт активен (`deletedAt IS NULL`). Оба токена (`admin_token`,
 * `app_token`) несут `id` в payload — читаем только его. Возвращает `null` при
 * отсутствии/битой/просроченной куке, неизвестном или удалённом пользователе.
 */
export async function resolveUserFromCookie(
  c: Context,
  cookieName: string,
): Promise<DbUser | null> {
  const token = getCookie(c, cookieName);
  if (!token) return null;

  try {
    const payload = jwt.verify(token, JWT_SECRET) as { id: UUID };
    const user = await db.query.users.findFirst({
      where: eq(users.id, payload.id),
    });
    if (!user) return null;
    if (user.deletedAt !== null) return null; // удалённый аккаунт — сессия недействительна
    return user;
  } catch {
    return null;
  }
}

export const requireAdmin = createMiddleware(async (c, next) => {
  const user = await resolveUserFromCookie(c, 'admin_token');
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  if (user.role !== 'admin') {
    return c.json({ error: 'Forbidden' }, 403);
  }

  c.set('adminUser', {
    id: user.id,
    username: user.username,
    role: user.role,
  });

  await next();
});

export const requireUser = createMiddleware(async (c, next) => {
  const user = await resolveUserFromCookie(c, 'app_token');
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  c.set('appUser', user);

  await next();
});
