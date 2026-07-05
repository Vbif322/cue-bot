import type { UUID } from 'crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { db } from '@/db/db.js';
import { loginTokens } from '@/db/schema.js';
import { createAdminServer } from '@/admin/server/index.js';

import { adminCookie, apiRequest, expiredCookie } from '../../helpers/auth.js';
import {
  createAdminUser,
  createLoginToken,
  createUser,
} from '../../helpers/factories.js';
import { truncateAll } from '../../helpers/truncate.js';

const app = createAdminServer();

describe('admin auth router', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  describe('GET /api/auth/token', () => {
    it('redirects to / with admin_token cookie and consumes the token', async () => {
      const admin = await createAdminUser();
      const record = await createLoginToken(admin.id);

      const { res, status } = await apiRequest(
        app,
        'GET',
        `/api/auth/token?t=${record.token}`,
      );

      expect(status).toBe(302);
      expect(res.headers.get('location')).toBe('/');

      const setCookie = res.headers.get('set-cookie') ?? '';
      expect(setCookie).toContain('admin_token=');
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Lax');
      expect(setCookie).toContain(`Max-Age=${String(24 * 60 * 60)}`);

      // Token is single-use: deleted after redemption.
      const remaining = await db.query.loginTokens.findFirst({
        where: eq(loginTokens.token, record.token),
      });
      expect(remaining).toBeUndefined();
    });

    it('redirects to /login?error=invalid when t is missing', async () => {
      const { status, res } = await apiRequest(app, 'GET', '/api/auth/token');
      expect(status).toBe(302);
      expect(res.headers.get('location')).toBe('/login?error=invalid');
    });

    it('redirects to /login?error=invalid for an unknown token', async () => {
      const { res } = await apiRequest(
        app,
        'GET',
        '/api/auth/token?t=does-not-exist',
      );
      expect(res.headers.get('location')).toBe('/login?error=invalid');
    });

    it('redirects to /login?error=invalid for an expired token', async () => {
      const admin = await createAdminUser();
      const record = await createLoginToken(admin.id, {
        expiresAt: new Date(Date.now() - 1000),
      });

      const { res } = await apiRequest(
        app,
        'GET',
        `/api/auth/token?t=${record.token}`,
      );
      expect(res.headers.get('location')).toBe('/login?error=invalid');
    });

    it('redirects to /login?error=forbidden when the user is not an admin', async () => {
      const user = await createUser();
      const record = await createLoginToken(user.id);

      const { res } = await apiRequest(
        app,
        'GET',
        `/api/auth/token?t=${record.token}`,
      );
      expect(res.headers.get('location')).toBe('/login?error=forbidden');

      // A non-admin attempt still consumes the token.
      const remaining = await db.query.loginTokens.findFirst({
        where: eq(loginTokens.token, record.token),
      });
      expect(remaining).toBeUndefined();
    });
  });

  describe('POST /api/auth/logout', () => {
    it('clears the cookie', async () => {
      const { status, res, body } = await apiRequest<{ ok: boolean }>(
        app,
        'POST',
        '/api/auth/logout',
      );
      expect(status).toBe(200);
      expect(body).toEqual({ ok: true });
      expect(res.headers.get('set-cookie') ?? '').toContain('Max-Age=0');
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns user: null without a cookie', async () => {
      const { status, body } = await apiRequest<{ user: unknown }>(
        app,
        'GET',
        '/api/auth/me',
      );
      expect(status).toBe(200);
      expect(body).toEqual({ user: null });
    });

    it('returns the admin user for a valid cookie', async () => {
      const admin = await createAdminUser();
      const { body } = await apiRequest<{
        user: { id: UUID; username: string; role: string };
      }>(app, 'GET', '/api/auth/me', { user: admin });

      expect(body.user).toEqual({
        id: admin.id,
        username: admin.username,
        role: 'admin',
      });
    });

    it('returns user: null for a malformed token', async () => {
      const { body } = await apiRequest<{ user: unknown }>(
        app,
        'GET',
        '/api/auth/me',
        { cookie: 'admin_token=not-a-jwt' },
      );
      expect(body).toEqual({ user: null });
    });

    it('returns user: null for an expired token', async () => {
      const admin = await createAdminUser();
      const { body } = await apiRequest<{ user: unknown }>(
        app,
        'GET',
        '/api/auth/me',
        { cookie: expiredCookie(admin) },
      );
      expect(body).toEqual({ user: null });
    });

    it('returns user: null when the role was revoked in the DB', async () => {
      // Token says admin, but the DB row is now a plain user.
      const user = await createUser();
      const { body } = await apiRequest<{ user: unknown }>(
        app,
        'GET',
        '/api/auth/me',
        { cookie: adminCookie({ ...user, role: 'admin' }) },
      );
      expect(body).toEqual({ user: null });
    });
  });
});
