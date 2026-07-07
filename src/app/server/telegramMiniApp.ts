import { createPublicKey, verify as edVerify, type KeyObject } from 'crypto';

import { asString, type TelegramClaims } from './telegramClaims.js';

/**
 * Чистая (без БД) верификация Telegram Mini App `initData` по НОВОЙ схеме Telegram —
 * Ed25519-подпись поля `signature` публичным ключом Telegram (без секрета из
 * BOT_TOKEN). Вынесена отдельно, чтобы юнит-тесты подписи не тянули пул/сервер
 * (как telegramOidc.ts). См.
 * https://core.telegram.org/bots/webapps#validating-data-for-third-party-use —
 * раздел про валидацию третьей стороной (Ed25519).
 *
 * Схема: message = `${bot_id}:WebAppData\n` + отсортированные "key=value" всех полей
 * initData КРОМЕ `hash` и `signature`, через "\n"; валиден, если
 * Ed25519.verify(message, base64url(signature), telegramPubKey) и auth_date свежий.
 */

/** Продовый публичный Ed25519-ключ Telegram (hex), общий для всех ботов. */
const TELEGRAM_PUBLIC_KEY_HEX =
  'e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d';

/** DER SPKI-префикс для «сырого» Ed25519-ключа (RFC 8410) — 12 байт. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/**
 * initData свежее часа: он регенерируется при каждом открытии Mini App, а авто-вход
 * происходит на старте. Узкое окно важно: initData — переиспользуемый credential без
 * одноразовости, шире окно — дольше живёт перехваченная строка.
 */
const MAX_AUTH_AGE_SEC = 60 * 60;
const MAX_FUTURE_SKEW_SEC = 60;

export type MiniAppResult =
  | { ok: true; data: TelegramClaims }
  | { ok: false; reason: string };

let cachedKey: KeyObject | undefined;
function telegramPublicKey(): KeyObject {
  if (!cachedKey) {
    // `TELEGRAM_MINIAPP_PUBLIC_KEY` (hex) переопределяет ключ — для тестового
    // окружения Telegram или для тестов (подпись своим ключом). Читаем лениво.
    const hex =
      process.env.TELEGRAM_MINIAPP_PUBLIC_KEY ?? TELEGRAM_PUBLIC_KEY_HEX;
    const der = Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(hex, 'hex')]);
    cachedKey = createPublicKey({ key: der, format: 'der', type: 'spki' });
  }
  return cachedKey;
}

/**
 * @param botId числовая часть BOT_TOKEN (до двоеточия) — входит в подписанное сообщение.
 */
export function verifyMiniAppInitData(
  initData: string,
  botId: string,
  nowMs?: number,
): MiniAppResult {
  const params = new URLSearchParams(initData);

  const signature = params.get('signature');
  if (!signature) return { ok: false, reason: 'Отсутствует signature' };
  const authDateRaw = params.get('auth_date');
  if (!authDateRaw) return { ok: false, reason: 'Отсутствует auth_date' };

  // data_check_string: все поля КРОМЕ hash и signature, "key=value", по ключу, через "\n".
  const pairs: string[] = [];
  for (const [key, value] of params) {
    if (key === 'hash' || key === 'signature') continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const message = Buffer.from(
    `${botId}:WebAppData\n${pairs.join('\n')}`,
    'utf8',
  );

  let valid = false;
  try {
    valid = edVerify(
      null,
      message,
      telegramPublicKey(),
      Buffer.from(signature, 'base64url'),
    );
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'Неверная подпись' };

  const authDate = Number(authDateRaw);
  if (!Number.isFinite(authDate)) {
    return { ok: false, reason: 'Некорректное поле auth_date' };
  }
  const nowSec = Math.floor((nowMs ?? Date.now()) / 1000);
  if (
    nowSec - authDate > MAX_AUTH_AGE_SEC ||
    authDate - nowSec > MAX_FUTURE_SKEW_SEC
  ) {
    return { ok: false, reason: 'initData устарел' };
  }

  const userRaw = params.get('user');
  if (!userRaw) return { ok: false, reason: 'Отсутствует user' };
  let user: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(userRaw);
    if (typeof parsed !== 'object' || parsed === null) throw new Error();
    user = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, reason: 'Некорректный user' };
  }

  const id = typeof user.id === 'number' ? String(user.id) : asString(user.id);
  const firstName = asString(user.first_name);
  if (!id || !firstName) {
    return { ok: false, reason: 'В user нет id/first_name' };
  }

  const data: TelegramClaims = { id, firstName };
  const username = asString(user.username);
  if (username) data.username = username;
  const surname = asString(user.last_name);
  if (surname) data.surname = surname;
  const photoUrl = asString(user.photo_url);
  if (photoUrl) data.photoUrl = photoUrl;

  return { ok: true, data };
}
