import type { UUID } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

import { db } from '@/db/db.js';
import { userIdentities, users } from '@/db/schema.js';
import { createAdminServer } from '@/admin/server/index.js';

import { apiRequest, appCookie } from '../../helpers/auth.js';
import { createUser } from '../../helpers/factories.js';
import { truncateAll } from '../../helpers/truncate.js';

// Plaintext-код только уходит в письмо (в БД sha256) — перехватываем из мока.
vi.mock('@/services/mailService.js', () => ({
  sendLoginCodeEmail: vi.fn(),
}));
import { sendLoginCodeEmail } from '@/services/mailService.js';
const mockedSend = vi.mocked(sendLoginCodeEmail);

let app: ReturnType<typeof createAdminServer>;

// Пер-email лимитер — модульный синглтон, truncateAll его не сбрасывает: уникальный
// адрес на каждый вызов исключает взаимное влияние тестов.
let emailSeq = 0;
const nextEmail = (): string => `link${String(emailSeq++)}@example.com`;

const REQUEST = '/api/app/auth/email/request-code';
const VERIFY = '/api/app/auth/email/verify';

/** Запрашивает код привязки под сессией `cookie` и возвращает перехваченный plaintext. */
async function requestLinkCode(cookie: string, email: string): Promise<string> {
  mockedSend.mockClear();
  const { status } = await apiRequest(app, 'POST', REQUEST, {
    cookie,
    body: { email },
  });
  expect(status).toBe(200);
  const call = mockedSend.mock.calls.at(-1);
  if (!call) throw new Error('sendLoginCodeEmail не был вызван');
  expect(call[0]).toBe(email);
  return call[1];
}

async function identitiesOf(userId: UUID) {
  return db.query.userIdentities.findMany({
    where: (i, { eq: e }) => e(i.userId, userId),
  });
}

describe('app email link — привязка почты к текущему аккаунту', () => {
  beforeEach(async () => {
    app = createAdminServer();
    await truncateAll();
  });

  it('привязывает email: identity + users.email + emailVerified', async () => {
    const user = await createUser({ telegram_id: '700', username: 'tg700' });
    const cookie = appCookie(user.id);
    const email = nextEmail();
    const code = await requestLinkCode(cookie, email);

    const verify = await apiRequest<{ data: { user: { id: UUID } } }>(
      app,
      'POST',
      VERIFY,
      { cookie, body: { email, code } },
    );
    expect(verify.status).toBe(200);
    expect(verify.body.data.user.id).toBe(user.id);

    const idents = await identitiesOf(user.id);
    const emailIdent = idents.find((i) => i.provider === 'email');
    expect(emailIdent?.providerId).toBe(email);
    expect(emailIdent?.emailVerifiedAt).not.toBeNull();

    const fresh = await db.query.users.findFirst({
      where: eq(users.id, user.id),
    });
    expect(fresh?.email).toBe(email);
    expect(fresh?.telegram_id).toBe('700'); // не тронут

    const me = await apiRequest<{
      data: { emailVerified: boolean; telegramLinked: boolean };
    }>(app, 'GET', '/api/app/me', { cookie });
    expect(me.body.data.emailVerified).toBe(true);
  });

  it('идемпотентно: повторная привязка того же адреса не дублирует identity', async () => {
    const user = await createUser({ telegram_id: '705', username: 'tg705' });
    await db.insert(userIdentities).values({
      userId: user.id,
      provider: 'email',
      providerId: 'same@example.com',
      emailVerifiedAt: new Date(),
    });
    const cookie = appCookie(user.id);

    // request-code возвращает 400 «уже привязана» для того же адреса.
    const res = await apiRequest(app, 'POST', REQUEST, {
      cookie,
      body: { email: 'same@example.com' },
    });
    expect(res.status).toBe(400);
    expect(await identitiesOf(user.id)).toHaveLength(1);
  });

  it('отклоняет, если у аккаунта уже есть ДРУГАЯ почта', async () => {
    const user = await createUser({ telegram_id: '701', username: 'tg701' });
    await db.insert(userIdentities).values({
      userId: user.id,
      provider: 'email',
      providerId: 'first@example.com',
      emailVerifiedAt: new Date(),
    });
    const cookie = appCookie(user.id);

    const res = await apiRequest(app, 'POST', REQUEST, {
      cookie,
      body: { email: nextEmail() },
    });
    expect(res.status).toBe(400);
  });

  it('отклоняет, если email занят другим аккаунтом', async () => {
    const other = await createUser();
    const email = nextEmail();
    await db.insert(userIdentities).values({
      userId: other.id,
      provider: 'email',
      providerId: email,
      emailVerifiedAt: new Date(),
    });
    const user = await createUser({ telegram_id: '702', username: 'tg702' });
    const cookie = appCookie(user.id);

    const res = await apiRequest(app, 'POST', REQUEST, {
      cookie,
      body: { email },
    });
    expect(res.status).toBe(400);
  });

  it('неверный код → 400 и identity не создаётся', async () => {
    const user = await createUser({ telegram_id: '703', username: 'tg703' });
    const cookie = appCookie(user.id);
    const email = nextEmail();
    const code = await requestLinkCode(cookie, email);
    const wrong = code === '000000' ? '111111' : '000000';

    const res = await apiRequest(app, 'POST', VERIFY, {
      cookie,
      body: { email, code: wrong },
    });
    expect(res.status).toBe(400);
    expect(await identitiesOf(user.id)).toHaveLength(0);
  });

  it('без сессии → 401', async () => {
    const res = await apiRequest(app, 'POST', REQUEST, {
      body: { email: nextEmail() },
    });
    expect(res.status).toBe(401);
  });
});
