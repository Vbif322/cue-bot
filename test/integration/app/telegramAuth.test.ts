import type { UUID } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

import { db } from '@/db/db.js';
import { userIdentities, users } from '@/db/schema.js';
import { createAdminServer } from '@/admin/server/index.js';

import { apiRequest, appCookie } from '../../helpers/auth.js';
import { createUser } from '../../helpers/factories.js';
import { signTelegramPayload } from '../../helpers/telegram.js';
import { truncateAll } from '../../helpers/truncate.js';

// Интеграции идут с BOT_TOKEN='test-token' (db.setupFile) — подписываем им.
const TOKEN = 'test-token';

const AUTH = '/api/app/auth/telegram';
const LINK = '/api/app/me/telegram';

let app: ReturnType<typeof createAdminServer>;

/** Валидный payload виджета со свежим auth_date, подписанный тестовым токеном. */
function tgPayload(overrides: Record<string, unknown> = {}) {
  const merged: Record<string, unknown> = {
    id: 987654,
    first_name: 'Иван',
    username: 'ivan',
    auth_date: Math.floor(Date.now() / 1000),
    ...overrides,
  };
  // JSON.stringify выкидывает undefined-поля при передаче — убираем их и из
  // подписи, иначе data_check_string на сервере не совпадёт (hash mismatch).
  const fields = Object.fromEntries(
    Object.entries(merged).filter(([, value]) => value !== undefined),
  );
  return signTelegramPayload(fields, TOKEN);
}

async function identitiesOf(userId: UUID) {
  return db.query.userIdentities.findMany({
    where: (i, { eq: e }) => e(i.userId, userId),
  });
}

/** Мимикрия бэкфилла миграции 0014: telegram-identity для существующего юзера. */
async function seedBackfilledBotUser(telegramId: string) {
  const user = await createUser({ telegram_id: telegramId, username: telegramId });
  await db.insert(userIdentities).values({
    userId: user.id,
    provider: 'telegram',
    providerId: telegramId,
  });
  return user;
}

function hasAppTokenCookie(res: Response): boolean {
  return (res.headers.get('set-cookie') ?? '').includes('app_token=');
}

function appTokenSetCookie(res: Response): string {
  return res.headers.get('set-cookie') ?? '';
}

describe('app telegram auth router — вход через виджет', () => {
  beforeEach(async () => {
    app = createAdminServer();
    await truncateAll();
  });

  it('COOP=same-origin-allow-popups — попап oauth.telegram.org может вернуть результат', async () => {
    // Дефолтный same-origin рвёт window.opener → Telegram Login Widget «молча» не входит.
    const res = await apiRequest(app, 'POST', AUTH, { body: tgPayload({ id: 987654 }) });
    expect(res.res.headers.get('cross-origin-opener-policy')).toBe(
      'same-origin-allow-popups',
    );
  });

  it('вход существующего (бэкфилленного) бот-юзера → тот же аккаунт, без дублей', async () => {
    const existing = await seedBackfilledBotUser('987654');

    const res = await apiRequest<{ data: { user: { id: UUID } } }>(
      app,
      'POST',
      AUTH,
      { body: tgPayload({ id: 987654 }) },
    );

    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(existing.id);
    expect(hasAppTokenCookie(res.res)).toBe(true);
    // Кука сессии — SameSite=Lax (не Strict), иначе она «теряется» на межсайтовых
    // переходах (заход по ссылке из Telegram, возврат из OAuth-попапа).
    expect(appTokenSetCookie(res.res)).toMatch(/SameSite=Lax/i);

    // Ни лишних users с этим telegram_id, ни дублей telegram-identity.
    const sameTg = await db.query.users.findMany({
      where: eq(users.telegram_id, '987654'),
    });
    expect(sameTg).toHaveLength(1);
    const identities = await identitiesOf(existing.id);
    expect(identities).toHaveLength(1);
    expect(identities[0]?.provider).toBe('telegram');
  });

  it('вход нового telegram-юзера создаёт users + telegram-identity', async () => {
    const res = await apiRequest<{ data: { user: { id: UUID } } }>(
      app,
      'POST',
      AUTH,
      { body: tgPayload({ id: 555000 }) },
    );

    expect(res.status).toBe(200);
    const userId = res.body.data.user.id;

    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    expect(user?.telegram_id).toBe('555000');

    const identities = await identitiesOf(userId);
    expect(identities).toHaveLength(1);
    expect(identities[0]?.provider).toBe('telegram');
    expect(identities[0]?.providerId).toBe('555000');
  });

  it('невалидный hash → 401 без куки, причина в логе', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bad = { ...tgPayload(), hash: 'deadbeef'.repeat(8) };
    const res = await apiRequest(app, 'POST', AUTH, { body: bad });

    expect(res.status).toBe(401);
    expect(hasAppTokenCookie(res.res)).toBe(false);
    // Клиенту причину не раскрываем, но в лог пишем конкретный reason (диагностика прода).
    expect(warn).toHaveBeenCalledWith('Telegram login rejected:', 'Неверная подпись');
    warn.mockRestore();
  });

  it('просроченный auth_date → 401 без куки, причина в логе', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const stale = tgPayload({ auth_date: Math.floor(Date.now() / 1000) - 600 });
    const res = await apiRequest(app, 'POST', AUTH, { body: stale });

    expect(res.status).toBe(401);
    expect(hasAppTokenCookie(res.res)).toBe(false);
    expect(warn).toHaveBeenCalledWith('Telegram login rejected:', 'Ссылка устарела');
    warn.mockRestore();
  });

  it('username берётся из first_name, если в payload нет username', async () => {
    const res = await apiRequest<{ data: { user: { id: UUID; username: string } } }>(
      app,
      'POST',
      AUTH,
      { body: tgPayload({ id: 42, first_name: 'Марк', username: undefined }) },
    );

    expect(res.status).toBe(200);
    expect(res.body.data.user.username).toBe('Марк');
  });
});

describe('app me telegram link — привязка из профиля', () => {
  beforeEach(async () => {
    app = createAdminServer();
    await truncateAll();
  });

  it('привязывает Telegram: identity + telegram_id, me.telegramLinked=true', async () => {
    const user = await createUser({ email: 'p@example.com' });
    const cookie = appCookie(user.id);

    const before = await apiRequest<{ data: { telegramLinked: boolean } }>(
      app,
      'GET',
      '/api/app/me',
      { cookie },
    );
    expect(before.body.data.telegramLinked).toBe(false);

    const res = await apiRequest<{ data: { telegramLinked: boolean } }>(
      app,
      'POST',
      LINK,
      { cookie, body: tgPayload({ id: 111222 }) },
    );
    expect(res.status).toBe(200);
    expect(res.body.data.telegramLinked).toBe(true);

    const fresh = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    expect(fresh?.telegram_id).toBe('111222');

    const identities = await identitiesOf(user.id);
    expect(identities.some((i) => i.provider === 'telegram')).toBe(true);

    const me = await apiRequest<{ data: { telegramLinked: boolean } }>(
      app,
      'GET',
      '/api/app/me',
      { cookie },
    );
    expect(me.body.data.telegramLinked).toBe(true);
  });

  it('этот Telegram уже за другим юзером → 409', async () => {
    await seedBackfilledBotUser('333444');
    const user = await createUser({ email: 'other@example.com' });

    const res = await apiRequest<{ error: string }>(app, 'POST', LINK, {
      cookie: appCookie(user.id),
      body: tgPayload({ id: 333444 }),
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('другому аккаунту');
  });

  it('у текущего аккаунта уже привязан другой Telegram → 409', async () => {
    const user = await seedBackfilledBotUser('900');

    const res = await apiRequest(app, 'POST', LINK, {
      cookie: appCookie(user.id),
      body: tgPayload({ id: 901 }),
    });

    expect(res.status).toBe(409);
  });

  it('повторная привязка того же Telegram к своему аккаунту идемпотентна', async () => {
    const user = await createUser({ email: 'idem@example.com' });
    const cookie = appCookie(user.id);
    const payload = () => tgPayload({ id: 700700 });

    const first = await apiRequest(app, 'POST', LINK, { cookie, body: payload() });
    expect(first.status).toBe(200);
    const second = await apiRequest(app, 'POST', LINK, { cookie, body: payload() });
    expect(second.status).toBe(200);

    const telegramIdentities = (await identitiesOf(user.id)).filter(
      (i) => i.provider === 'telegram',
    );
    expect(telegramIdentities).toHaveLength(1);
  });
});

describe('схождение способов входа', () => {
  beforeEach(async () => {
    app = createAdminServer();
    await truncateAll();
  });

  it('email-юзер привязал Telegram → вход виджетом попадает в тот же аккаунт', async () => {
    // Email-аккаунт (эмулируем как обычного созданного юзера) привязывает Telegram.
    const user = await createUser({ email: 'merge@example.com' });
    const link = await apiRequest(app, 'POST', LINK, {
      cookie: appCookie(user.id),
      body: tgPayload({ id: 424242 }),
    });
    expect(link.status).toBe(200);

    // Затем самостоятельный вход через виджет с тем же telegram id.
    const login = await apiRequest<{ data: { user: { id: UUID } } }>(
      app,
      'POST',
      AUTH,
      { body: tgPayload({ id: 424242 }) },
    );
    expect(login.status).toBe(200);
    expect(login.body.data.user.id).toBe(user.id);

    // Ровно один telegram-identity — привязка и вход не наплодили дублей.
    const telegramIdentities = (await identitiesOf(user.id)).filter(
      (i) => i.provider === 'telegram',
    );
    expect(telegramIdentities).toHaveLength(1);
  });
});
