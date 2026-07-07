import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import { eq } from 'drizzle-orm';
import jwt, { type SignOptions } from 'jsonwebtoken';
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

/**
 * Тип JWT в claim'е `typ`: admin- и app-токены подписаны одним `JWT_SECRET`, поэтому
 * без типа они взаимозаменяемы. `resolveUserFromCookie` требует совпадения типа —
 * admin_token нельзя предъявить как app-сессию и наоборот (глубже, чем DB-проверка
 * роли в requireAdmin).
 */
export type TokenTyp = 'admin' | 'app';

/** Admin JWT — payload с ролью (для обратной совместимости кук) + typ. */
export function signToken(payload: AdminUser): string {
  return jwt.sign({ ...payload, typ: 'admin' satisfies TokenTyp }, JWT_SECRET, {
    expiresIn: '24h',
  });
}

/**
 * App JWT игрока — минимальный payload `{ id, typ }`. TTL по умолчанию 30 дней
 * (HttpOnly-кука); для Bearer-токена Mini App выдаётся короткий ('24h') — он
 * читаем из JS (XSS-риск) и не отзываем, поэтому окно утечки должно быть узким.
 */
export function signAppToken(
  id: UUID,
  ttl: SignOptions['expiresIn'] = '30d',
): string {
  return jwt.sign({ id, typ: 'app' satisfies TokenTyp }, JWT_SECRET, {
    expiresIn: ttl,
  });
}

export interface ResolveUserOptions {
  /** Имя куки с JWT (`admin_token` | `app_token`). */
  cookie: string;
  /** Ожидаемый `typ` токена; несовпадение (в т.ч. старый токен без typ) → null. */
  typ: TokenTyp;
  /**
   * Дополнительно принять токен из заголовка `Authorization: Bearer` (кука в
   * приоритете). Нужно для Telegram Mini App: в WebView куки ненадёжны, поэтому фронт
   * там держит короткоживущий app-токен в памяти и шлёт его заголовком. Только для
   * app-сессии — админку через Bearer не пускаем.
   */
  allowBearer?: boolean;
}

/**
 * Общий разбор куки в живого пользователя: читает JWT из куки `opts.cookie`,
 * верифицирует подпись и `typ`, перечитывает `users` из БД по `id` и возвращает
 * строку только если аккаунт активен (`deletedAt IS NULL`). Возвращает `null` при
 * отсутствии/битой/просроченной куке, чужом typ, неизвестном или удалённом
 * пользователе.
 */
export async function resolveUserFromCookie(
  c: Context,
  opts: ResolveUserOptions,
): Promise<DbUser | null> {
  let token = getCookie(c, opts.cookie);
  if (!token && opts.allowBearer === true) {
    const auth = c.req.header('Authorization');
    if (auth?.startsWith('Bearer ')) token = auth.slice('Bearer '.length);
  }
  if (!token) return null;

  try {
    const payload = jwt.verify(token, JWT_SECRET) as { id: UUID; typ?: string };
    if (payload.typ !== opts.typ) return null; // чужой/старый токен — не сессия
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

/** Опции app-сессии — общие для requireUser и опциональных резолвов в роутерах. */
export const APP_SESSION: ResolveUserOptions = {
  cookie: 'app_token',
  typ: 'app',
  allowBearer: true,
};

export const requireAdmin = createMiddleware(async (c, next) => {
  const user = await resolveUserFromCookie(c, { cookie: 'admin_token', typ: 'admin' });
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
  const user = await resolveUserFromCookie(c, APP_SESSION);
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  c.set('appUser', user);

  await next();
});
