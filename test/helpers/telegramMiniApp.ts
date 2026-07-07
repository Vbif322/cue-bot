import { generateKeyPairSync, sign as edSign } from 'crypto';

// Тестовая Ed25519-пара: публичный ключ кладём в TELEGRAM_MINIAPP_PUBLIC_KEY, чтобы
// верификатор доверял нашей подписи вместо продового ключа Telegram.
const { publicKey, privateKey } = generateKeyPairSync('ed25519');

const jwk = publicKey.export({ format: 'jwk' });
if (!jwk.x) throw new Error('в JWK нет параметра x');
/** Hex «сырого» (32 байта) публичного ключа для TELEGRAM_MINIAPP_PUBLIC_KEY. */
export const testMiniAppPublicKeyHex = Buffer.from(jwk.x, 'base64url').toString(
  'hex',
);

interface BuildOpts {
  botId: string;
  user: Record<string, unknown>;
  /** auth_date в секундах (по умолчанию — «сейчас»). */
  authDate?: number;
  /** Доп. поля initData (query_id, chat_instance…). */
  extra?: Record<string, string>;
  /** Подписать чужим (невалидным) содержимым — для негативного теста. */
  tamperSignature?: boolean;
}

/** Собирает валидно подписанную строку initData (как Telegram Mini App SDK). */
export function buildMiniAppInitData(opts: BuildOpts): string {
  const params = new URLSearchParams();
  params.set('user', JSON.stringify(opts.user));
  params.set(
    'auth_date',
    String(opts.authDate ?? Math.floor(Date.now() / 1000)),
  );
  for (const [k, v] of Object.entries(opts.extra ?? {})) params.set(k, v);

  const pairs: string[] = [];
  for (const [k, v] of params) {
    if (k === 'hash' || k === 'signature') continue;
    pairs.push(`${k}=${v}`);
  }
  pairs.sort();
  const message = Buffer.from(
    `${opts.botId}:WebAppData\n${pairs.join('\n')}`,
    'utf8',
  );
  const signed = opts.tamperSignature
    ? edSign(null, Buffer.from('другое сообщение'), privateKey)
    : edSign(null, message, privateKey);
  params.set('signature', signed.toString('base64url'));
  return params.toString();
}
