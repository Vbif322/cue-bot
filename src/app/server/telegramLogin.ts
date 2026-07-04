import { createHash, createHmac, timingSafeEqual } from 'crypto';

/**
 * Чистая (без БД) верификация payload Telegram Login Widget. Вынесена отдельно,
 * чтобы юнит-тесты подписи не тянули пул/сервер (как authCrypto.ts для кода).
 *
 * Схема Telegram: secret = SHA256(bot_token); data_check_string — все поля
 * payload КРОМЕ hash, отсортированные по ключу, в виде "key=value" через "\n";
 * валиден, если HMAC-SHA256(data_check_string, secret) == hash и auth_date
 * свежий. См. https://core.telegram.org/widgets/login#checking-authorization.
 */

/** Сырой payload виджета (значения приходят строками из query/JSON). */
export interface TelegramLoginPayload {
  id: number | string;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number | string;
  hash: string;
  [key: string]: unknown;
}

/** Нормализованные данные после успешной проверки. */
export interface VerifiedTelegramLogin {
  id: string;
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
}

export type TelegramLoginResult =
  | { ok: true; data: VerifiedTelegramLogin }
  | { ok: false; reason: string };

/** auth_date не должен быть старше 5 минут (±небольшой скью на часы клиента). */
const MAX_AUTH_AGE_SEC = 5 * 60;
const MAX_FUTURE_SKEW_SEC = 60;

/** Обязательные поля payload — без них подпись не построить/не сверить. */
const REQUIRED_FIELDS = ['id', 'first_name', 'auth_date', 'hash'] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Приводит значение поля к строке ровно так, как его подписывал Telegram. */
function fieldToString(value: unknown): string {
  return typeof value === 'string' ? value : String(value);
}

export function verifyTelegramLogin(
  payload: unknown,
  botToken: string,
  nowMs?: number,
): TelegramLoginResult {
  if (!isRecord(payload)) {
    return { ok: false, reason: 'Некорректные данные Telegram' };
  }

  for (const field of REQUIRED_FIELDS) {
    const value = payload[field];
    if (value === undefined || value === null || value === '') {
      return { ok: false, reason: `Отсутствует поле ${field}` };
    }
  }

  const hash = fieldToString(payload.hash);

  // data_check_string: все полученные поля кроме hash, "key=value", отсортированы
  // по ключу, через "\n". Берём именно присланные поля (не фиксированный список) —
  // так требует спецификация, иначе подпись не сойдётся.
  const dataCheckString = Object.keys(payload)
    .filter((key) => key !== 'hash')
    .sort()
    .map((key) => `${key}=${fieldToString(payload[key])}`)
    .join('\n');

  const secretKey = createHash('sha256').update(botToken).digest();
  const expected = createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  // Сравнение постоянного времени. timingSafeEqual бросает при разной длине —
  // поэтому сначала сверяем длину (её утечка безопасна: hex-длина фиксирована).
  if (
    expected.length !== hash.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(hash))
  ) {
    return { ok: false, reason: 'Неверная подпись' };
  }

  const authDate = Number(payload.auth_date);
  if (!Number.isFinite(authDate)) {
    return { ok: false, reason: 'Некорректное поле auth_date' };
  }
  const nowSec = Math.floor((nowMs ?? Date.now()) / 1000);
  if (
    nowSec - authDate > MAX_AUTH_AGE_SEC ||
    authDate - nowSec > MAX_FUTURE_SKEW_SEC
  ) {
    return { ok: false, reason: 'Ссылка устарела' };
  }

  const data: VerifiedTelegramLogin = {
    id: fieldToString(payload.id),
    firstName: fieldToString(payload.first_name),
  };
  if (payload.last_name !== undefined && payload.last_name !== null) {
    data.lastName = fieldToString(payload.last_name);
  }
  if (payload.username !== undefined && payload.username !== null) {
    data.username = fieldToString(payload.username);
  }
  if (payload.photo_url !== undefined && payload.photo_url !== null) {
    data.photoUrl = fieldToString(payload.photo_url);
  }

  return { ok: true, data };
}
