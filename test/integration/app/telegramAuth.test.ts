import type { UUID } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import jwt from 'jsonwebtoken';

import { db } from '@/db/db.js';
import { userIdentities, users } from '@/db/schema.js';
import { createAdminServer } from '@/admin/server/index.js';
import { JWT_SECRET, signToken } from '@/admin/server/middleware.js';

import { apiRequest, appCookie, type ApiResponse } from '../../helpers/auth.js';
import {
  createConfirmedParticipant,
  createTournament,
  createUser,
} from '../../helpers/factories.js';
import { truncateAll } from '../../helpers/truncate.js';
import {
  buildMiniAppInitData,
  testMiniAppPublicKeyHex,
} from '../../helpers/telegramMiniApp.js';

// OIDC-клиент для интеграций — telegramOidc читает эти env в рантайме (не при импорте).
process.env.TELEGRAM_CLIENT_ID = 'test-client';
process.env.TELEGRAM_CLIENT_SECRET = 'test-secret';
process.env.TELEGRAM_REDIRECT_URI =
  'http://localhost/api/app/auth/telegram/callback';
// Mini App: верификатор доверяет нашей тестовой паре (BOT_TOKEN='test-token' в setup).
process.env.TELEGRAM_MINIAPP_PUBLIC_KEY = testMiniAppPublicKeyHex;
const BOT_ID = 'test-token';

let app: ReturnType<typeof createAdminServer>;

function base64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

/**
 * Неподписанный id_token с валидными iss/aud/exp. verifyIdToken подпись НЕ проверяет
 * (токен приходит по доверенному back-channel), поэтому «alg: none» достаточно.
 */
function makeIdToken(claims: Record<string, unknown>): string {
  const header = base64url({ alg: 'none', typ: 'JWT' });
  const payload = base64url({
    iss: 'https://oauth.telegram.org',
    aud: 'test-client',
    exp: Math.floor(Date.now() / 1000) + 600,
    ...claims,
  });
  return `${header}.${payload}.sig`;
}

interface FlowOpts {
  claims: Record<string, unknown>;
  link?: boolean;
  /** app_token для привязки (intent='link' требует вошедшего пользователя). */
  startCookie?: string;
  /** Переопределить state в callback (для проверки CSRF-несовпадения). */
  stateOverride?: string;
  /** token endpoint отдаёт ошибку. */
  tokenFails?: boolean;
}

interface FlowResult {
  start: ApiResponse<unknown>;
  cb: ApiResponse<unknown>;
}

/**
 * Прогоняет OIDC-поток целиком: GET /start (снимаем tg_oauth-куку и state из
 * redirect-URL) → мокаем token endpoint (глобальный fetch) → GET /callback.
 * Бросает, если /start не увёл на Telegram (нет куки/стейта) — вызывать только
 * когда ожидаем успешный редирект на согласие.
 */
async function oidcFlow(opts: FlowOpts): Promise<FlowResult> {
  const startPath = `/api/app/auth/telegram/start${opts.link ? '?link=1' : ''}`;
  const start = await apiRequest(
    app,
    'GET',
    startPath,
    opts.startCookie ? { cookie: opts.startCookie } : {},
  );

  const loc = start.res.headers.get('location') ?? '';
  const tgOauth = /tg_oauth=([^;]+)/.exec(
    start.res.headers.get('set-cookie') ?? '',
  )?.[1];
  const state = loc.startsWith('http')
    ? new URL(loc).searchParams.get('state')
    : null;
  if (!tgOauth || !state) {
    throw new Error(`/start не увёл на Telegram: ${loc}`);
  }

  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    opts.tokenFails
      ? new Response('boom', { status: 500 })
      : new Response(JSON.stringify({ id_token: makeIdToken(opts.claims) }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
  );

  const cb = await apiRequest(
    app,
    'GET',
    `/api/app/auth/telegram/callback?code=abc&state=${opts.stateOverride ?? state}`,
    { cookie: `tg_oauth=${tgOauth}` },
  );
  fetchSpy.mockRestore();
  return { start, cb };
}

function location(res: Response): string {
  return res.headers.get('location') ?? '';
}
function hasAppTokenCookie(res: Response): boolean {
  return (res.headers.get('set-cookie') ?? '').includes('app_token=');
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

describe('app telegram auth router — вход через OIDC', () => {
  beforeEach(async () => {
    app = createAdminServer();
    await truncateAll();
  });

  it('/start редиректит на oauth.telegram.org с PKCE и ставит tg_oauth', async () => {
    const start = await apiRequest(app, 'GET', '/api/app/auth/telegram/start');
    expect(start.status).toBe(302);
    const url = new URL(location(start.res));
    expect(url.origin + url.pathname).toBe('https://oauth.telegram.org/auth');
    expect(url.searchParams.get('client_id')).toBe('test-client');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(start.res.headers.get('set-cookie') ?? '').toMatch(/tg_oauth=/);
  });

  it('вход существующего (бэкфилленного) бот-юзера → тот же аккаунт, без дублей', async () => {
    const existing = await seedBackfilledBotUser('987654');

    const { cb } = await oidcFlow({ claims: { sub: '987654', name: 'Иван' } });

    expect(cb.status).toBe(302);
    expect(location(cb.res)).toBe('/');
    expect(hasAppTokenCookie(cb.res)).toBe(true);
    // Кука сессии — SameSite=Lax (не Strict), иначе «теряется» на возврате из Telegram.
    expect(cb.res.headers.get('set-cookie') ?? '').toMatch(/SameSite=Lax/i);

    const sameTg = await db.query.users.findMany({
      where: eq(users.telegram_id, '987654'),
    });
    expect(sameTg).toHaveLength(1);
    const identities = await identitiesOf(existing.id);
    expect(identities).toHaveLength(1);
    expect(identities[0]?.provider).toBe('telegram');
  });

  it('вход нового telegram-юзера создаёт users + telegram-identity', async () => {
    const { cb } = await oidcFlow({ claims: { sub: '555000', name: 'Пётр' } });
    expect(cb.status).toBe(302);
    expect(hasAppTokenCookie(cb.res)).toBe(true);

    const user = await db.query.users.findFirst({
      where: eq(users.telegram_id, '555000'),
    });
    if (!user) throw new Error('пользователь не создан');
    const identities = await identitiesOf(user.id);
    expect(identities).toHaveLength(1);
    expect(identities[0]?.providerId).toBe('555000');
  });

  it('username берётся из name, если в claims нет preferred_username', async () => {
    await oidcFlow({ claims: { sub: '42', name: 'Марк' } });
    const user = await db.query.users.findFirst({
      where: eq(users.telegram_id, '42'),
    });
    expect(user?.username).toBe('Марк');
  });

  it('ошибка token endpoint → редирект на /login?telegram=error без куки', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { cb } = await oidcFlow({ claims: { sub: '1' }, tokenFails: true });

    expect(cb.status).toBe(302);
    expect(location(cb.res)).toBe('/login?telegram=error');
    expect(hasAppTokenCookie(cb.res)).toBe(false);
    warn.mockRestore();
  });

  it('несовпадение state → редирект на /login?telegram=error без куки', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { cb } = await oidcFlow({
      claims: { sub: '2', name: 'X' },
      stateOverride: 'подделка',
    });

    expect(cb.status).toBe(302);
    expect(location(cb.res)).toBe('/login?telegram=error');
    expect(hasAppTokenCookie(cb.res)).toBe(false);
    warn.mockRestore();
  });

  it('пользователь отменил согласие (error в query) → /login?telegram=cancelled', async () => {
    const start = await apiRequest(app, 'GET', '/api/app/auth/telegram/start');
    const tgOauth = /tg_oauth=([^;]+)/.exec(
      start.res.headers.get('set-cookie') ?? '',
    )?.[1];

    const cb = await apiRequest(
      app,
      'GET',
      '/api/app/auth/telegram/callback?error=access_denied',
      { cookie: `tg_oauth=${tgOauth ?? ''}` },
    );
    expect(location(cb.res)).toBe('/login?telegram=cancelled');
  });
});

describe('app telegram link — привязка из профиля через OIDC', () => {
  beforeEach(async () => {
    app = createAdminServer();
    await truncateAll();
  });

  it('/start?link=1 без сессии → редирект на /login?telegram=auth_required', async () => {
    const start = await apiRequest(
      app,
      'GET',
      '/api/app/auth/telegram/start?link=1',
    );
    expect(location(start.res)).toBe('/login?telegram=auth_required');
  });

  it('привязывает Telegram: identity + telegram_id, редирект /profile?telegram=linked', async () => {
    const user = await createUser({ email: 'p@example.com' });

    const { cb } = await oidcFlow({
      claims: { sub: '111222', name: 'Аня' },
      link: true,
      startCookie: appCookie(user.id),
    });

    expect(location(cb.res)).toBe('/profile?telegram=linked');
    const fresh = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    expect(fresh?.telegram_id).toBe('111222');
    const identities = await identitiesOf(user.id);
    expect(identities.some((i) => i.provider === 'telegram')).toBe(true);
  });

  it('этот Telegram уже за другим юзером → /profile?telegram=exists', async () => {
    await seedBackfilledBotUser('333444');
    const user = await createUser({ email: 'other@example.com' });

    const { cb } = await oidcFlow({
      claims: { sub: '333444', name: 'X' },
      link: true,
      startCookie: appCookie(user.id),
    });
    expect(location(cb.res)).toBe('/profile?telegram=exists');
  });

  it('у текущего аккаунта уже привязан другой Telegram → /profile?telegram=has_other', async () => {
    const user = await seedBackfilledBotUser('900');

    const { cb } = await oidcFlow({
      claims: { sub: '901', name: 'X' },
      link: true,
      startCookie: appCookie(user.id),
    });
    expect(location(cb.res)).toBe('/profile?telegram=has_other');
  });

  it('повторная привязка того же Telegram к своему аккаунту идемпотентна', async () => {
    const user = await createUser({ email: 'idem@example.com' });
    const cookie = appCookie(user.id);
    const claims = { sub: '700700', name: 'X' };

    const first = await oidcFlow({ claims, link: true, startCookie: cookie });
    expect(location(first.cb.res)).toBe('/profile?telegram=linked');
    const second = await oidcFlow({ claims, link: true, startCookie: cookie });
    expect(location(second.cb.res)).toBe('/profile?telegram=linked');

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

  it('email-юзер привязал Telegram → OIDC-вход попадает в тот же аккаунт', async () => {
    const user = await createUser({ email: 'merge@example.com' });
    const claims = { sub: '424242', name: 'X' };

    const link = await oidcFlow({
      claims,
      link: true,
      startCookie: appCookie(user.id),
    });
    expect(location(link.cb.res)).toBe('/profile?telegram=linked');

    const login = await oidcFlow({ claims });
    expect(location(login.cb.res)).toBe('/');
    expect(hasAppTokenCookie(login.cb.res)).toBe(true);

    // Тот же telegram_id ведёт ровно к одному аккаунту — дублей не наплодили.
    const sameTg = await db.query.users.findMany({
      where: eq(users.telegram_id, '424242'),
    });
    expect(sameTg).toHaveLength(1);
    expect(sameTg[0]?.id).toBe(user.id);
    const telegramIdentities = (await identitiesOf(user.id)).filter(
      (i) => i.provider === 'telegram',
    );
    expect(telegramIdentities).toHaveLength(1);
  });
});

describe('app telegram Mini App — авто-вход по initData', () => {
  const MINIAPP = '/api/app/auth/telegram/miniapp';

  beforeEach(async () => {
    app = createAdminServer();
    await truncateAll();
  });

  it('валидный initData нового юзера → сессия + users + identity', async () => {
    const initData = buildMiniAppInitData({
      botId: BOT_ID,
      user: { id: 771100, first_name: 'Глеб', username: 'gleb' },
    });

    const res = await apiRequest<{ data: { user: { id: UUID } } }>(
      app,
      'POST',
      MINIAPP,
      { body: { initData } },
    );

    expect(res.status).toBe(200);
    expect(hasAppTokenCookie(res.res)).toBe(true);
    expect(res.res.headers.get('set-cookie') ?? '').toMatch(/SameSite=Lax/i);

    const user = await db.query.users.findFirst({
      where: eq(users.telegram_id, '771100'),
    });
    if (!user) throw new Error('пользователь не создан');
    expect(res.body.data.user.id).toBe(user.id);
    const identities = await identitiesOf(user.id);
    expect(identities).toHaveLength(1);
    expect(identities[0]?.providerId).toBe('771100');
  });

  it('initData существующего бот-юзера → тот же аккаунт, без дублей', async () => {
    const existing = await seedBackfilledBotUser('987654');
    const initData = buildMiniAppInitData({
      botId: BOT_ID,
      user: { id: 987654, first_name: 'Иван' },
    });

    const res = await apiRequest<{ data: { user: { id: UUID } } }>(
      app,
      'POST',
      MINIAPP,
      { body: { initData } },
    );

    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(existing.id);
    const sameTg = await db.query.users.findMany({
      where: eq(users.telegram_id, '987654'),
    });
    expect(sameTg).toHaveLength(1);
  });

  it('подделанная подпись → 401 без куки, причина в логе', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const initData = buildMiniAppInitData({
      botId: BOT_ID,
      user: { id: 5, first_name: 'X' },
      tamperSignature: true,
    });

    const res = await apiRequest(app, 'POST', MINIAPP, { body: { initData } });

    expect(res.status).toBe(401);
    expect(hasAppTokenCookie(res.res)).toBe(false);
    warn.mockRestore();
  });

  it('пустой initData → 400', async () => {
    const res = await apiRequest(app, 'POST', MINIAPP, { body: { initData: '' } });
    expect(res.status).toBe(400);
  });

  it('возвращает token, по нему GET /me авторизует через Bearer (без куки)', async () => {
    const initData = buildMiniAppInitData({
      botId: BOT_ID,
      user: { id: 808080, first_name: 'Бэрер' },
    });
    const login = await apiRequest<{ data: { token: string } }>(
      app,
      'POST',
      MINIAPP,
      { body: { initData } },
    );
    expect(login.status).toBe(200);
    const token = login.body.data.token;
    expect(typeof token).toBe('string');

    // Куку НЕ шлём — только заголовок Authorization. requireUser должен пустить.
    const me = await apiRequest<{ data: { user: { telegramId: string | null } } }>(
      app,
      'GET',
      '/api/app/auth/me',
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(me.status).toBe(200);
    expect(me.body.data.user).toBeDefined();
  });

  it('token в теле — короткоживущий (24ч) app-токен; кука — 30 дней', async () => {
    const initData = buildMiniAppInitData({
      botId: BOT_ID,
      user: { id: 424242, first_name: 'Срок' },
    });
    const login = await apiRequest<{ data: { token: string } }>(
      app,
      'POST',
      MINIAPP,
      { body: { initData } },
    );
    expect(login.status).toBe(200);

    const bearer = jwt.decode(login.body.data.token) as {
      exp: number;
      iat: number;
      typ: string;
    };
    expect(bearer.typ).toBe('app');
    expect(bearer.exp - bearer.iat).toBe(24 * 60 * 60);

    const cookieToken = /app_token=([^;]+)/.exec(
      login.res.headers.get('set-cookie') ?? '',
    )?.[1];
    if (!cookieToken) throw new Error('нет app_token в set-cookie');
    const cookie = jwt.decode(cookieToken) as { exp: number; iat: number };
    expect(cookie.exp - cookie.iat).toBe(30 * 24 * 60 * 60);
  });

  it('Bearer действует и на публичных GET: private-турнир виден участнику без куки', async () => {
    const initData = buildMiniAppInitData({
      botId: BOT_ID,
      user: { id: 909090, first_name: 'Приват' },
    });
    const login = await apiRequest<{ data: { user: { id: UUID }; token: string } }>(
      app,
      'POST',
      MINIAPP,
      { body: { initData } },
    );
    expect(login.status).toBe(200);
    const { user, token } = login.body.data;

    const tournament = await createTournament({ visibility: 'private' });
    await createConfirmedParticipant(tournament.id, { userId: user.id });

    // Гость private-турнир не видит…
    const anon = await apiRequest(app, 'GET', `/api/app/tournaments/${tournament.id}`);
    expect(anon.status).toBe(404);
    // …а Bearer-only сессия участника (кука в WebView не сохранилась) — видит.
    const asUser = await apiRequest(
      app,
      'GET',
      `/api/app/tournaments/${tournament.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(asUser.status).toBe(200);
  });

  it('чужой typ: admin_token и токен без typ не проходят как app-сессия', async () => {
    const admin = await createUser({ role: 'admin' });
    const adminToken = signToken({
      id: admin.id,
      username: admin.username,
      role: admin.role,
    });
    const noTyp = jwt.sign({ id: admin.id }, JWT_SECRET, { expiresIn: '1h' });

    for (const token of [adminToken, noTyp]) {
      const viaBearer = await apiRequest(app, 'GET', '/api/app/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(viaBearer.status).toBe(401);
      const viaCookie = await apiRequest(app, 'GET', '/api/app/auth/me', {
        cookie: `app_token=${token}`,
      });
      expect(viaCookie.status).toBe(401);
    }
  });
});
