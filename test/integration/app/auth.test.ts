import type { UUID } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';

import { db } from '@/db/db.js';
import { userIdentities, users } from '@/db/schema.js';
import { createAdminServer } from '@/admin/server/index.js';

import { apiRequest, appCookie } from '../../helpers/auth.js';
import { createUser } from '../../helpers/factories.js';
import { truncateAll } from '../../helpers/truncate.js';

// Plaintext-код нигде не хранится (в БД только sha256), поэтому перехватываем его
// из аргумента отправки письма. Мок заодно избавляет тесты от загрузки nodemailer.
vi.mock('@/services/mailService.js', () => ({
  sendLoginCodeEmail: vi.fn(),
}));
import { sendLoginCodeEmail } from '@/services/mailService.js';
const mockedSend = vi.mocked(sendLoginCodeEmail);

// Свежий сервер на каждый тест — сбрасывает пер-IP лимитеры внутри роутера
// (в тестах все запросы приходят с одного «IP», иначе они бы накапливались).
let app: ReturnType<typeof createAdminServer>;

// Уникальный email на каждый тест: пер-email лимитер — модульный синглтон и
// НЕ сбрасывается truncateAll; разные адреса исключают взаимное влияние тестов.
let emailSeq = 0;
const nextEmail = (): string => `player${String(emailSeq++)}@example.com`;

const REQUEST = '/api/app/auth/request-code';
const VERIFY = '/api/app/auth/verify-code';

/** Запрашивает код и возвращает перехваченный из письма plaintext. */
async function requestCode(email: string): Promise<string> {
  mockedSend.mockClear();
  const { status } = await apiRequest(app, 'POST', REQUEST, { body: { email } });
  expect(status).toBe(200);
  const call = mockedSend.mock.calls.at(-1);
  if (!call) throw new Error('sendLoginCodeEmail не был вызван');
  expect(call[0]).toBe(email);
  return call[1];
}

/** Достаёт `app_token=...` из Set-Cookie ответа (для последующих запросов). */
function appTokenCookie(res: Response): string {
  const sc = res.headers.get('set-cookie') ?? '';
  const token = /app_token=([^;]+)/.exec(sc)?.[1];
  if (!token) throw new Error('Set-Cookie без app_token');
  return `app_token=${token}`;
}

async function identitiesOf(userId: UUID) {
  return db.query.userIdentities.findMany({
    where: (i, { eq: e }) => e(i.userId, userId),
  });
}

describe('app auth router — беспарольный вход', () => {
  beforeEach(async () => {
    app = createAdminServer();
    await truncateAll();
  });

  it('request-code → verify-code создаёт users+identity, me, logout', async () => {
    const email = nextEmail();
    const code = await requestCode(email);

    const verify = await apiRequest<{ data: { user: { id: UUID } } }>(
      app,
      'POST',
      VERIFY,
      { body: { email, code } },
    );
    expect(verify.status).toBe(200);
    const userId = verify.body.data.user.id;
    const cookie = appTokenCookie(verify.res);

    // Создан ровно один users + одна email-identity с проставленным verified_at.
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    expect(user?.email).toBe(email);
    expect(user?.username).toBe(email.split('@')[0]); // local-part
    const identities = await identitiesOf(userId);
    expect(identities).toHaveLength(1);
    expect(identities[0]?.provider).toBe('email');
    expect(identities[0]?.providerId).toBe(email);
    expect(identities[0]?.emailVerifiedAt).not.toBeNull();

    // me возвращает публичный вид (без role/telegram_id/deletedAt).
    const me = await apiRequest<{ data: { user: Record<string, unknown> } }>(
      app,
      'GET',
      '/api/app/auth/me',
      { cookie },
    );
    expect(me.status).toBe(200);
    expect(me.body.data.user.id).toBe(userId);
    expect(me.body.data.user).not.toHaveProperty('role');
    expect(me.body.data.user).not.toHaveProperty('telegram_id');

    // logout чистит куку.
    const logout = await apiRequest(app, 'POST', '/api/app/auth/logout', {
      cookie,
    });
    expect(logout.status).toBe(200);
    expect(logout.res.headers.get('set-cookie') ?? '').toContain('Max-Age=0');
  });

  it('повторный вход существующим email-юзером не дублирует users/identity', async () => {
    const email = nextEmail();

    const code1 = await requestCode(email);
    const v1 = await apiRequest<{ data: { user: { id: UUID } } }>(
      app,
      'POST',
      VERIFY,
      { body: { email, code: code1 } },
    );
    const userId = v1.body.data.user.id;

    const code2 = await requestCode(email);
    const v2 = await apiRequest<{ data: { user: { id: UUID } } }>(
      app,
      'POST',
      VERIFY,
      { body: { email, code: code2 } },
    );
    expect(v2.status).toBe(200);
    expect(v2.body.data.user.id).toBe(userId);

    const allUsers = await db.query.users.findMany({
      where: eq(users.email, email),
    });
    expect(allUsers).toHaveLength(1);
    const emailIdentities = await db.query.userIdentities.findMany({
      where: and(
        eq(userIdentities.provider, 'email'),
        eq(userIdentities.providerId, email),
      ),
    });
    expect(emailIdentities).toHaveLength(1);
  });

  it('5 неверных попыток гасят код — верный код больше не принимается', async () => {
    const email = nextEmail();
    const code = await requestCode(email);
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < 5; i++) {
      const { status } = await apiRequest(app, 'POST', VERIFY, {
        body: { email, code: wrong },
      });
      expect(status).toBe(400);
    }

    const { status } = await apiRequest(app, 'POST', VERIFY, {
      body: { email, code },
    });
    expect(status).toBe(400);
  });

  it('повторное погашение уже использованного кода → 400', async () => {
    const email = nextEmail();
    const code = await requestCode(email);

    const first = await apiRequest(app, 'POST', VERIFY, {
      body: { email, code },
    });
    expect(first.status).toBe(200);

    const second = await apiRequest(app, 'POST', VERIFY, {
      body: { email, code },
    });
    expect(second.status).toBe(400);
  });

  it('новый request-code гасит предыдущий код', async () => {
    const email = nextEmail();
    const oldCode = await requestCode(email);
    const newCode = await requestCode(email);
    expect(newCode).not.toBe(oldCode);

    const stale = await apiRequest(app, 'POST', VERIFY, {
      body: { email, code: oldCode },
    });
    expect(stale.status).toBe(400);

    const fresh = await apiRequest(app, 'POST', VERIFY, {
      body: { email, code: newCode },
    });
    expect(fresh.status).toBe(200);
  });

  it('request-code всегда 200 (без user enumeration)', async () => {
    const { status, body } = await apiRequest<{ data: { ok: boolean } }>(
      app,
      'POST',
      REQUEST,
      { body: { email: nextEmail() } },
    );
    expect(status).toBe(200);
    expect(body).toEqual({ data: { ok: true } });
  });

  it('вход по email soft-deleted аккаунта → 400 без выдачи куки', async () => {
    const email = nextEmail();

    // Заводим email-аккаунт штатным входом.
    const code1 = await requestCode(email);
    const v1 = await apiRequest<{ data: { user: { id: UUID } } }>(
      app,
      'POST',
      VERIFY,
      { body: { email, code: code1 } },
    );
    expect(v1.status).toBe(200);
    const userId = v1.body.data.user.id;

    // Помечаем аккаунт удалённым (tombstone).
    await db
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, userId));

    // Свежий код валиден, но identity ведёт на tombstone → 400, куки нет.
    const code2 = await requestCode(email);
    const v2 = await apiRequest(app, 'POST', VERIFY, {
      body: { email, code: code2 },
    });
    expect(v2.status).toBe(400);
    expect(v2.res.headers.get('set-cookie') ?? '').not.toContain('app_token');
  });

  it('requireUser отвергает куку удалённого (deletedAt) юзера', async () => {
    const user = await createUser();
    const cookie = appCookie(user.id);

    // Пока активен — me работает.
    const ok = await apiRequest(app, 'GET', '/api/app/auth/me', { cookie });
    expect(ok.status).toBe(200);

    await db
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, user.id));

    const gone = await apiRequest(app, 'GET', '/api/app/auth/me', { cookie });
    expect(gone.status).toBe(401);
  });
});
