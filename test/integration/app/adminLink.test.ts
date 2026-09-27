import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { db } from '@/db/db.js';
import { loginTokens } from '@/db/schema.js';
import { createAdminServer } from '@/admin/server/index.js';
import { signAppToken } from '@/admin/server/middleware.js';

import { apiRequest, appCookie } from '../../helpers/auth.js';
import { createAdminUser, createUser } from '../../helpers/factories.js';
import { truncateAll } from '../../helpers/truncate.js';

// Свежий сервер на каждый тест — сбрасывает пер-IP лимитер редима /api/auth/token.
let app: ReturnType<typeof createAdminServer>;

const ADMIN_LINK = '/api/app/auth/admin-link';

/** Путь+query редима из абсолютного URL, который вернул admin-link. */
function redeemPath(url: string): string {
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
}

describe('POST /api/app/auth/admin-link — переход сайт → админка', () => {
  beforeEach(async () => {
    app = createAdminServer();
    await truncateAll();
  });

  it('без сессии → 401', async () => {
    const { status } = await apiRequest(app, 'POST', ADMIN_LINK);
    expect(status).toBe(401);
  });

  it('обычный игрок → 403, токен не выпускается', async () => {
    const user = await createUser();
    const { status } = await apiRequest(app, 'POST', ADMIN_LINK, {
      cookie: appCookie(user.id),
    });
    expect(status).toBe(403);
    expect(await db.query.loginTokens.findMany()).toHaveLength(0);
  });

  it('админ получает одноразовую ссылку, редим ставит admin_token', async () => {
    const admin = await createAdminUser();
    const { status, body } = await apiRequest<{ data: { url: string } }>(
      app,
      'POST',
      ADMIN_LINK,
      { cookie: appCookie(admin.id) },
    );
    expect(status).toBe(200);
    // Тесты идут не в production — ссылка на локальный Vite-сервер admin/.
    expect(new URL(body.data.url).origin).toBe('http://localhost:5173');
    const path = redeemPath(body.data.url);
    expect(path).toMatch(/^\/api\/auth\/token\?t=[0-9a-f]{32}$/);

    const token = new URL(body.data.url).searchParams.get('t') ?? '';
    const record = await db.query.loginTokens.findFirst({
      where: eq(loginTokens.token, token),
    });
    expect(record?.userId).toBe(admin.id);
    // Короткий TTL: ссылка открывается сразу же.
    const ttlMs = (record?.expiresAt.getTime() ?? Infinity) - Date.now();
    expect(ttlMs).toBeLessThanOrEqual(60_000);

    const redeem = await apiRequest(app, 'GET', path);
    expect(redeem.status).toBe(302);
    expect(redeem.res.headers.get('location')).toBe('/');
    expect(redeem.res.headers.get('set-cookie')).toContain('admin_token=');

    // Повторно ссылка не работает.
    const again = await apiRequest(app, 'GET', path);
    expect(again.res.headers.get('location')).toBe('/login?error=invalid');
  });

  it('Bearer-сессия Mini App тоже получает ссылку', async () => {
    const admin = await createAdminUser();
    const { status } = await apiRequest(app, 'POST', ADMIN_LINK, {
      headers: { Authorization: `Bearer ${signAppToken(admin.id, '24h')}` },
    });
    expect(status).toBe(200);
  });

  it('/api/app/auth/me отдаёт isAdmin', async () => {
    const admin = await createAdminUser();
    const user = await createUser();
    const asAdmin = await apiRequest<{ data: { user: { isAdmin: boolean } } }>(
      app,
      'GET',
      '/api/app/auth/me',
      { cookie: appCookie(admin.id) },
    );
    const asUser = await apiRequest<{ data: { user: { isAdmin: boolean } } }>(
      app,
      'GET',
      '/api/app/auth/me',
      { cookie: appCookie(user.id) },
    );
    expect(asAdmin.body.data.user.isAdmin).toBe(true);
    expect(asUser.body.data.user.isAdmin).toBe(false);
  });
});
