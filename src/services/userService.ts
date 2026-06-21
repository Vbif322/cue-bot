import { eq } from 'drizzle-orm';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import { users, loginTokens, dialogSessions } from '@/db/schema.js';
import type { DbUser } from '@/bot/types.js';
import type { ApiUser } from '@/bot/@types/user.js';

export const MAX_NAME_LENGTH = 50;
export const MAX_SURNAME_LENGTH = 100;

/** Отображаемое имя анонимизированного («удалённого») аккаунта. */
export const DELETED_USERNAME = 'Удалённый аккаунт';

/**
 * Allow-lists a DB row onto the admin-API shape. Explicit field selection keeps the
 * exposed surface a conscious decision — a new column stays hidden until added here.
 */
export function toApiUser(u: DbUser): ApiUser {
  return {
    id: u.id,
    telegram_id: u.telegram_id,
    username: u.username,
    phone: u.phone,
    email: u.email,
    name: u.name,
    surname: u.surname,
    role: u.role,
    deletedAt: u.deletedAt,
  };
}

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

/**
 * «Удаляет» пользователя через анонимизацию (soft-delete). Строку не удаляем —
 * затираем персональные данные, обнуляем `telegram_id` и выставляем `deletedAt`.
 * Все внешние ключи (матчи, турниры, история) остаются валидными и отображаются
 * как «{@link DELETED_USERNAME}». Обнуление `telegram_id` освобождает условный
 * уникальный индекс и делает строку «мёртвой»: повторный вход того же человека
 * создаст новую запись. Логин-токены удаляются, чтобы оборвать активные сессии.
 */
export async function anonymizeUser(userId: UUID): Promise<void> {
  await db.transaction(async (tx) => {
    // Читаем telegram_id ДО обнуления: диалоговые сессии ключуются им.
    const existing = await tx.query.users.findFirst({
      columns: { telegram_id: true },
      where: eq(users.id, userId),
    });

    await tx
      .update(users)
      .set({
        username: DELETED_USERNAME,
        telegram_id: null,
        name: null,
        surname: null,
        phone: null,
        email: null,
        role: 'user',
        deletedAt: new Date(),
      })
      .where(eq(users.id, userId));

    await tx.delete(loginTokens).where(eq(loginTokens.userId, userId));

    // Обрываем активные wizard/диалоговые сессии этого telegram-аккаунта.
    if (existing?.telegram_id != null) {
      await tx
        .delete(dialogSessions)
        .where(eq(dialogSessions.key, existing.telegram_id));
    }
  });
}
