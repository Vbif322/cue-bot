import { createHash, randomBytes } from 'crypto';

import { asString, type TelegramClaims } from './telegramClaims.js';

/**
 * Чистые (без БД) хелперы OIDC-входа через Telegram (Authorization Code Flow + PKCE).
 * Вынесены отдельно, чтобы юнит-тесты не тянули пул/сервер (как telegramLogin.ts до
 * миграции и authCrypto.ts для кода на почту).
 *
 * Поток: браузер редиректится на AUTH_ENDPOINT с code_challenge (S256) и state; после
 * согласия Telegram возвращает `code` на redirect_uri; бэкенд обменивает его на токены
 * на TOKEN_ENDPOINT прямым server-to-server вызовом (Basic client_id:client_secret +
 * PKCE code_verifier) и достаёт данные пользователя из id_token (JWT).
 *
 * Подпись id_token НЕ проверяем: токен получен по прямому TLS-каналу с TOKEN_ENDPOINT
 * (сертификат сервера = oauth.telegram.org), не через браузер — по OIDC Core §3.1.3.7
 * валидации claim'ов (iss/aud/exp) в этом случае достаточно. См.
 * https://openid.net/specs/openid-connect-core-1_0.html#CodeIDToken.
 */

const ISSUER = 'https://oauth.telegram.org';
const AUTH_ENDPOINT = `${ISSUER}/auth`;
const TOKEN_ENDPOINT = `${ISSUER}/token`;

/** Нормализованные данные пользователя из id_token после проверки. */
export type TelegramOidcClaims = TelegramClaims;

export type TelegramOidcResult =
  | { ok: true; data: TelegramOidcClaims }
  | { ok: false; reason: string };

function clientId(): string {
  const id = process.env.TELEGRAM_CLIENT_ID;
  if (!id) throw new Error('TELEGRAM_CLIENT_ID не задан');
  return id;
}

function clientSecret(): string {
  const secret = process.env.TELEGRAM_CLIENT_SECRET;
  if (!secret) throw new Error('TELEGRAM_CLIENT_SECRET не задан');
  return secret;
}

/** base64url без паддинга (для PKCE-challenge и разбора JWT). */
function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * PKCE-пара: verifier — 32 случайных байта (base64url), challenge — base64url(SHA256).
 * verifier кладём в короткоживущую куку, challenge уходит в AUTH-редирект.
 */
export function createPkce(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

/** Случайный state для защиты от CSRF на редиректе (сверяется в callback). */
export function createState(): string {
  return base64url(randomBytes(16));
}

/**
 * redirect_uri, ЗАРЕГИСТРИРОВАННЫЙ в BotFather (Bot Settings → Web Login). Должен
 * ПОБАЙТОВО совпадать в auth-запросе и при обмене кода — иначе Telegram отклонит.
 * Явный `TELEGRAM_REDIRECT_URI` (в dev — origin Vite, напр.
 * http://localhost:5173/api/app/auth/telegram/callback); иначе строим из
 * PUBLIC_BASE_URL.
 */
export function redirectUri(): string {
  const explicit = process.env.TELEGRAM_REDIRECT_URI;
  if (explicit) return explicit;
  const base = process.env.PUBLIC_BASE_URL;
  if (!base) {
    throw new Error('TELEGRAM_REDIRECT_URI или PUBLIC_BASE_URL не задан');
  }
  return `${base.replace(/\/$/, '')}/api/app/auth/telegram/callback`;
}

/** URL авторизации, на который редиректим браузер. */
export function buildAuthUrl(opts: {
  state: string;
  codeChallenge: string;
  redirectUri: string;
}): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    response_type: 'code',
    scope: 'openid',
    redirect_uri: opts.redirectUri,
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/**
 * Обмен authorization code на id_token (server-to-server). Basic-авторизация
 * client_id:client_secret, тело — x-www-form-urlencoded с PKCE code_verifier.
 * Возвращает сырой id_token или бросает при сетевой/HTTP-ошибке.
 */
export async function exchangeCode(opts: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<string> {
  const basic = Buffer.from(`${clientId()}:${clientSecret()}`).toString('base64');
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: opts.code,
      redirect_uri: opts.redirectUri,
      code_verifier: opts.codeVerifier,
    }).toString(),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Token endpoint ${String(res.status)}: ${detail.slice(0, 200)}`);
  }

  const json = (await res.json()) as { id_token?: unknown };
  if (typeof json.id_token !== 'string' || json.id_token === '') {
    throw new Error('В ответе token endpoint нет id_token');
  }
  return json.id_token;
}

/** Разбирает payload JWT (средняя часть) без проверки подписи — см. коммент вверху. */
function decodeJwtPayload(idToken: string): Record<string, unknown> | null {
  const parts = idToken.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Проверяет id_token: iss/aud/exp (подпись — нет, токен из доверенного back-channel).
 * Возвращает нормализованные claim'ы либо reason ошибки.
 */
export function verifyIdToken(
  idToken: string,
  nowMs?: number,
): TelegramOidcResult {
  const payload = decodeJwtPayload(idToken);
  if (!payload) return { ok: false, reason: 'Некорректный id_token' };

  if (payload.iss !== ISSUER) {
    return { ok: false, reason: `Неверный iss: ${String(payload.iss)}` };
  }

  // aud может быть строкой или массивом строк (по спецификации OIDC).
  const aud = payload.aud;
  const audOk = Array.isArray(aud)
    ? aud.includes(clientId())
    : aud === clientId();
  if (!audOk) return { ok: false, reason: 'Неверный aud' };

  const exp = payload.exp;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) {
    return { ok: false, reason: 'Отсутствует exp' };
  }
  const nowSec = Math.floor((nowMs ?? Date.now()) / 1000);
  if (nowSec >= exp) return { ok: false, reason: 'id_token истёк' };

  const id = asString(payload.sub);
  if (!id) return { ok: false, reason: 'Отсутствует sub' };

  const firstName = asString(payload.name) ?? asString(payload.preferred_username) ?? id;

  const data: TelegramOidcClaims = { id, firstName };
  const username = asString(payload.preferred_username);
  if (username) data.username = username;
  const photoUrl = asString(payload.picture);
  if (photoUrl) data.photoUrl = photoUrl;

  return { ok: true, data };
}
