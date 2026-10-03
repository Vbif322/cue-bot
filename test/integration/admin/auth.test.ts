import type { UUID } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

import { db } from '@/db/db.js';
import {
  emailLoginCodes,
  loginTokens,
  userIdentities,
  users,
} from '@/db/schema.js';
import { createAdminServer } from '@/admin/server/index.js';

import { adminCookie, apiRequest, expiredCookie } from '../../helpers/auth.js';
import {
  createAdminUser,
  createLoginToken,
  createUser,
} from '../../helpers/factories.js';
import { truncateAll } from '../../helpers/truncate.js';

// Plaintext-код хранится только как sha256 — перехватываем его из аргумента отправки.
vi.mock('@/services/mailService.js', () => ({
  sendLoginCodeEmail: vi.fn(),
}));
import { sendLoginCodeEmail } from '@/services/mailService.js';
const mockedSend = vi.mocked(sendLoginCodeEmail);

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
      expect(body.user).toBeNull();
    });

    it('always returns playerUrl for the «Сайт игрока» link', async () => {
      const admin = await createAdminUser();
      const guest = await apiRequest<{ playerUrl: string }>(
        app,
        'GET',
        '/api/auth/me',
      );
      const authed = await apiRequest<{ playerUrl: string }>(
        app,
        'GET',
        '/api/auth/me',
        { user: admin },
      );
      // Тесты идут не в production — всегда локальный Vite-сервер app/.
      const expected = 'http://localhost:5174';
      expect(guest.body.playerUrl).toBe(expected);
      expect(authed.body.playerUrl).toBe(expected);
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
      expect(body.user).toBeNull();
    });

    it('returns user: null for an expired token', async () => {
      const admin = await createAdminUser();
      const { body } = await apiRequest<{ user: unknown }>(
        app,
        'GET',
        '/api/auth/me',
        { cookie: expiredCookie(admin) },
      );
      expect(body.user).toBeNull();
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
      expect(body.user).toBeNull();
    });
  });
});

describe('admin auth router — вход по коду на почту', () => {
  const REQUEST = '/api/auth/request-code';
  const VERIFY = '/api/auth/verify-code';

  // Свежий сервер на каждый тест — сбрасывает пер-IP лимитеры роутера.
  let emailApp: ReturnType<typeof createAdminServer>;

  // Пер-email лимитер — модульный синглтон, truncateAll его не сбрасывает.
  let emailSeq = 0;
  const nextEmail = (): string => `admin${String(emailSeq++)}@example.com`;

  beforeEach(async () => {
    emailApp = createAdminServer();
    await truncateAll();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** Привязывает к пользователю email-identity (по умолчанию подтверждённую). */
  async function linkEmail(userId: UUID, email: string, verified = true) {
    await db.insert(userIdentities).values({
      userId,
      provider: 'email',
      providerId: email,
      emailVerifiedAt: verified ? new Date() : null,
    });
  }

  /** Запрашивает код и возвращает перехваченный из письма plaintext. */
  async function requestCode(email: string): Promise<string> {
    mockedSend.mockClear();
    const { status } = await apiRequest(emailApp, 'POST', REQUEST, {
      body: { email },
    });
    expect(status).toBe(200);
    const call = mockedSend.mock.calls.at(-1);
    if (!call) throw new Error('sendLoginCodeEmail не был вызван');
    return call[1];
  }

  it('админ входит по коду: admin_token выставлен, /me возвращает пользователя', async () => {
    const email = nextEmail();
    const admin = await createAdminUser();
    await linkEmail(admin.id, email);
    const code = await requestCode(email);

    const verify = await apiRequest<{
      data: { user: { id: UUID; role: string } };
    }>(emailApp, 'POST', VERIFY, { body: { email, code } });
    expect(verify.status).toBe(200);
    expect(verify.body.data.user).toMatchObject({
      id: admin.id,
      role: 'admin',
    });

    const setCookie = verify.res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain(`Max-Age=${String(24 * 60 * 60)}`);
    const token = /admin_token=([^;]+)/.exec(setCookie)?.[1];
    expect(token).toBeDefined();

    const me = await apiRequest<{ user: { id: UUID } | null }>(
      emailApp,
      'GET',
      '/api/auth/me',
      { cookie: `admin_token=${String(token)}` },
    );
    expect(me.body.user?.id).toBe(admin.id);
  });

  it('request-code выпускает код для любого адреса (без раскрытия роли)', async () => {
    const email = nextEmail();
    await requestCode(email);

    const codes = await db.query.emailLoginCodes.findMany({
      where: eq(emailLoginCodes.email, email),
    });
    expect(codes).toHaveLength(1);
  });

  it('неверный код → 400 без куки', async () => {
    const email = nextEmail();
    const admin = await createAdminUser();
    await linkEmail(admin.id, email);
    const code = await requestCode(email);
    const wrong = code === '000000' ? '111111' : '000000';

    const { status, res } = await apiRequest(emailApp, 'POST', VERIFY, {
      body: { email, code: wrong },
    });
    expect(status).toBe(400);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('верный код у не-админа → 403 без куки', async () => {
    const email = nextEmail();
    const user = await createUser();
    await linkEmail(user.id, email);
    const code = await requestCode(email);

    const { status, res } = await apiRequest(emailApp, 'POST', VERIFY, {
      body: { email, code },
    });
    expect(status).toBe(403);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('адрес без identity → 400, пользователь не создаётся', async () => {
    const email = nextEmail();
    const code = await requestCode(email);
    const before = await db.select({ id: users.id }).from(users);

    const { status } = await apiRequest(emailApp, 'POST', VERIFY, {
      body: { email, code },
    });
    expect(status).toBe(400);
    const after = await db.select({ id: users.id }).from(users);
    expect(after).toHaveLength(before.length);
  });

  it('неподтверждённая identity → 400', async () => {
    const email = nextEmail();
    const admin = await createAdminUser();
    await linkEmail(admin.id, email, false);
    const code = await requestCode(email);

    const { status } = await apiRequest(emailApp, 'POST', VERIFY, {
      body: { email, code },
    });
    expect(status).toBe(400);
  });

  it('soft-deleted админ → 400', async () => {
    const email = nextEmail();
    const admin = await createAdminUser({ deletedAt: new Date() });
    await linkEmail(admin.id, email);
    const code = await requestCode(email);

    const { status } = await apiRequest(emailApp, 'POST', VERIFY, {
      body: { email, code },
    });
    expect(status).toBe(400);
  });

  it('в production на чужом хосте маршруты отвечают 404', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ADMIN_BASE_URL', 'https://admin.example.com');
    const email = nextEmail();

    // apiRequest шлёт на http://localhost → Host: localhost, не admin-хост.
    const req = await apiRequest(emailApp, 'POST', REQUEST, {
      body: { email },
    });
    expect(req.status).toBe(404);
    const verify = await apiRequest(emailApp, 'POST', VERIFY, {
      body: { email, code: '123456' },
    });
    expect(verify.status).toBe(404);
    expect(mockedSend).not.toHaveBeenCalledWith(email, expect.anything());
  });
});
