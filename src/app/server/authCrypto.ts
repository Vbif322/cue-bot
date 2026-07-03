import { createHash, randomInt } from 'crypto';

/**
 * Чистые (без БД/nodemailer) хелперы для беспарольного входа по коду. Вынесены
 * отдельно, чтобы юнит-тесты нормализации/хэша не тянули почтовый транспорт и пул.
 */

/** Нормализует email для сравнения и хранения: обрезка пробелов + lowercase. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** sha256(hex) от кода — в БД хранится только он, plaintext уходит лишь в письмо. */
export function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/** Криптостойкий 6-значный код (000000–999999) с ведущими нулями. */
export function generateLoginCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}
