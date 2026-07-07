/**
 * Общая форма нормализованных данных Telegram-пользователя после верификации —
 * из OIDC id_token (`telegramOidc.ts`) или Mini App initData (`telegramMiniApp.ts`).
 * Оба верификатора сходятся в один вход `loginTelegramUser` (routes/auth.ts).
 * Отдельный модуль без импортов: юнит-тесты верификаторов не должны тянуть
 * серверные зависимости.
 */
export interface TelegramClaims {
  id: string;
  firstName: string;
  username?: string;
  surname?: string;
  photoUrl?: string;
}

/** Строка, если `v` — непустая строка; иначе `undefined`. */
export function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}
