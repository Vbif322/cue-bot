import type { UUID } from 'crypto';
import type { Hono } from 'hono';
import jwt from 'jsonwebtoken';

import {
  JWT_SECRET,
  signAppToken,
  signToken,
  type AdminUser,
} from '@/admin/server/middleware.js';

/** Minimal shape needed to mint an admin JWT (a `createUser` row satisfies it). */
export interface TokenUser {
  id: UUID;
  username: string;
  role: string;
}

function tokenPayload(user: TokenUser): AdminUser {
  return { id: user.id, username: user.username, role: user.role };
}

/** `Cookie` header value carrying a valid 24h admin token for `user`. */
export function adminCookie(user: TokenUser): string {
  return `admin_token=${signToken(tokenPayload(user))}`;
}

/** `Cookie` header value carrying a valid 30d app token for `userId`. */
export function appCookie(userId: UUID): string {
  return `app_token=${signAppToken(userId)}`;
}

/** `Cookie` header value carrying an already-expired token (for negative tests). */
export function expiredCookie(user: TokenUser): string {
  const token = jwt.sign(tokenPayload(user), JWT_SECRET, { expiresIn: -1 });
  return `admin_token=${token}`;
}

export interface ApiRequestOptions {
  /** Authenticate as this user (mints a valid admin cookie). */
  user?: TokenUser;
  /** Raw Cookie header — overrides `user`. Use for malformed/expired tokens. */
  cookie?: string;
  /** JSON request body; sets Content-Type automatically. */
  body?: unknown;
  /** Extra headers. */
  headers?: Record<string, string>;
}

export interface ApiResponse<T> {
  res: Response;
  status: number;
  body: T;
}

/**
 * Drive a Hono app via `app.fetch()` without binding a socket. Builds the
 * Request (cookie + JSON body), returns status and parsed JSON body. Redirects
 * are NOT followed — inspect `res.headers.get('location')`.
 */
export async function apiRequest<T = unknown>(
  app: Hono,
  method: string,
  path: string,
  opts: ApiRequestOptions = {},
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = { ...opts.headers };

  const cookie = opts.cookie ?? (opts.user ? adminCookie(opts.user) : undefined);
  if (cookie !== undefined) headers.Cookie = cookie;

  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }

  const res = await app.fetch(new Request(`http://localhost${path}`, init));
  const text = await res.text();
  const body = (text.length > 0 ? JSON.parse(text) : undefined) as T;

  return { res, status: res.status, body };
}
