import { eq } from 'drizzle-orm';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import { users } from '@/db/schema.js';
import type { DbUser } from '@/bot/types.js';

export const MAX_NAME_LENGTH = 50;
export const MAX_SURNAME_LENGTH = 100;

/** Ошибка валидации профиля — текст пригоден для показа пользователю. */
export class ProfileValidationError extends Error {}

/**
 * Нормализует значение поля профиля: обрезает пробелы, пустую строку трактует
 * как очистку (`null`), и бросает {@link ProfileValidationError} при превышении
 * длины. Чистая функция — без обращения к БД.
 */
export function normalizeProfileValue(
  value: string,
  maxLength: number,
  fieldLabel: string,
): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLength) {
    throw new ProfileValidationError(
      `${fieldLabel} не должно превышать ${String(maxLength)} символов.`,
    );
  }
  return trimmed;
}

export interface ProfileUpdate {
  name?: string | null | undefined;
  surname?: string | null | undefined;
}

/**
 * Обновляет имя/фамилию пользователя. Значения нормализуются через
 * {@link normalizeProfileValue}; передавайте только те поля, которые нужно
 * изменить. Бросает {@link ProfileValidationError} при некорректной длине.
 */
export async function updateUserProfile(
  userId: UUID,
  fields: ProfileUpdate,
): Promise<DbUser> {
  const patch: ProfileUpdate = {};

  if (fields.name !== undefined) {
    patch.name =
      fields.name === null
        ? null
        : normalizeProfileValue(fields.name, MAX_NAME_LENGTH, 'Имя');
  }
  if (fields.surname !== undefined) {
    patch.surname =
      fields.surname === null
        ? null
        : normalizeProfileValue(fields.surname, MAX_SURNAME_LENGTH, 'Фамилия');
  }

  const [updated] = await db
    .update(users)
    .set(patch)
    .where(eq(users.id, userId))
    .returning();

  if (!updated) throw new Error('Пользователь не найден');

  return updated;
}
