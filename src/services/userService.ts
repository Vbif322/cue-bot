import { and, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import {
  users,
  loginTokens,
  dialogSessions,
  userIdentities,
  matches,
  tournamentParticipants,
  tournamentReferees,
  disqualifications,
  matchCorrections,
  notifications,
  tournaments,
} from '@/db/schema.js';
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

/** Данные пользователя для SPA игрока — только то, что нужно самому владельцу. */
export interface AppUser {
  id: UUID;
  username: string;
  name: string | null;
  surname: string | null;
  email: string | null;
}

/**
 * Проекция строки `users` на публичный вид для приложения игрока. В отличие от
 * {@link toApiUser} не отдаёт `role`/`telegram_id`/`deletedAt` — приложение игрока
 * этих полей не показывает.
 */
export function toAppUser(u: DbUser): AppUser {
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    surname: u.surname,
    email: u.email,
  };
}

/**
 * Находит пользователя по email-identity или создаёт нового (беспарольный вход,
 * Этап 3). Всё в одной транзакции:
 * - identity `('email', email)` есть → берём её `users`-строку и, если это первый
 *   вход, проставляем `email_verified_at`;
 * - identity нет → создаём `users` (username = local-part адреса) и identity с
 *   `email_verified_at = now()`.
 *
 * `email` должен быть уже нормализован. Возвращает `null`, если email-identity
 * ведёт на soft-deleted аккаунт (`deletedAt != null`): пускать его нельзя —
 * `requireUser` всё равно отобьёт куку 401, так что честнее отказать здесь, чем
 * выдать ложно-успешный вход. Оживление/переезд identity удалённого аккаунта —
 * вне M1.
 *
 * Осознанное ограничение M1: если у telegram-юзера в `users.email` записан тот же
 * адрес, но email-identity ещё нет, здесь создаётся ОТДЕЛЬНЫЙ аккаунт —
 * `users.email` неуникален и не проверяется. Связывание аккаунтов и уникализация
 * `users.email` отложены за пределы M1 (см. план M1 «Отложено»); придут с
 * Telegram-виджетом / отдельным merge.
 */
export async function findOrCreateEmailUser(
  email: string,
): Promise<DbUser | null> {
  return db.transaction(async (tx) => {
    const identity = await tx.query.userIdentities.findFirst({
      where: and(
        eq(userIdentities.provider, 'email'),
        eq(userIdentities.providerId, email),
      ),
    });

    if (identity) {
      const user = await tx.query.users.findFirst({
        where: eq(users.id, identity.userId),
      });
      if (!user) throw new Error('Identity ссылается на несуществующего юзера');
      if (user.deletedAt !== null) return null; // tombstone — вход невозможен
      if (identity.emailVerifiedAt === null) {
        await tx
          .update(userIdentities)
          .set({ emailVerifiedAt: new Date() })
          .where(eq(userIdentities.id, identity.id));
      }
      return user;
    }

    const username = email.split('@')[0] ?? email;
    const [created] = await tx
      .insert(users)
      .values({ username, email })
      .returning();
    if (!created) throw new Error('Не удалось создать пользователя');

    await tx.insert(userIdentities).values({
      userId: created.id,
      provider: 'email',
      providerId: email,
      emailVerifiedAt: new Date(),
    });

    return created;
  });
}

/**
 * Привязывает email-identity к УЖЕ существующему аккаунту `userId` (зеркало
 * привязки Telegram, но для почты — вход по коду её подтверждает). Всё в одной
 * транзакции; вызывать только после успешной проверки кода на этот адрес.
 *
 * Возвращает статус (без исключений на ожидаемых конфликтах):
 * - `'linked'`  — identity создана (или уже была ровно эта — идемпотентно);
 * - `'has_other'` — у аккаунта уже есть ДРУГАЯ email-identity (unique (user_id,
 *   provider) допускает только одну — молча не перетираем);
 * - `'exists'`  — этот email уже привязан к другому аккаунту (тут нужен merge,
 *   а не привязка — вне объёма этой фичи).
 *
 * `email` должен быть нормализован. Заполняет `users.email`, если он пуст.
 */
export async function linkEmailToUser(
  userId: UUID,
  email: string,
): Promise<'linked' | 'has_other' | 'exists'> {
  return db.transaction(async (tx) => {
    const user = await tx.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!user) {
      throw new Error('Пользователь не найден');
    }
    if (user.deletedAt !== null) {
      throw new Error('Пользователь не найден');
    }

    // Своя email-identity уже есть? Совпадает — идемпотентно, иначе has_other.
    const own = await tx.query.userIdentities.findFirst({
      where: and(
        eq(userIdentities.userId, userId),
        eq(userIdentities.provider, 'email'),
      ),
    });
    if (own) {
      return own.providerId === email ? 'linked' : 'has_other';
    }

    // Email занят другим аккаунтом?
    const existing = await tx.query.userIdentities.findFirst({
      where: and(
        eq(userIdentities.provider, 'email'),
        eq(userIdentities.providerId, email),
      ),
    });
    if (existing) {
      return existing.userId === userId ? 'linked' : 'exists';
    }

    await tx.insert(userIdentities).values({
      userId,
      provider: 'email',
      providerId: email,
      emailVerifiedAt: new Date(),
    });
    if (user.email === null) {
      await tx.update(users).set({ email }).where(eq(users.id, userId));
    }
    return 'linked';
  });
}

/** Опции создания/обновления telegram-юзера — см. {@link getOrCreateTelegramUser}. */
export interface TelegramUserInput {
  /** Желаемый username (для бота: `telegram.username ?? 'user_<id>'`). */
  username: string;
  name?: string | undefined;
  surname?: string | undefined;
}

/**
 * Находит пользователя по `telegram_id` или создаёт нового вместе с
 * telegram-identity — общий код для `authMiddleware` (бот) и web-входа через
 * Telegram Login Widget (Этап 7). Всё в одной транзакции:
 *
 * 1. Освобождаем `username` от «протухшей» telegram-строки: usernames в Telegram
 *    переиспользуемы, а частичный уникальный индекс `users_username_telegram_unique`
 *    (WHERE telegram_id IS NOT NULL) иначе отбил бы вставку/апдейт.
 * 2. Ищем по `telegram_id`; нет → upsert `users` (onConflictDoUpdate по telegram_id),
 *    есть, но username устарел → синхронизируем.
 * 3. Вставляем identity `('telegram', telegramId)` с `onConflictDoNothing` — всегда:
 *    для бэкфилленных бот-юзеров это no-op, а для web-first случая (telegram_id есть,
 *    identity ещё нет) — доводит реестр входов до консистентного состояния.
 *
 * Tombstone-ветки нет: {@link anonymizeUser} зануляет `telegram_id` и удаляет
 * identity, поэтому soft-deleted аккаунт по `telegram_id` не находится — повторный
 * вход штатно создаёт новую строку.
 */
export async function getOrCreateTelegramUser(
  telegramId: string,
  opts: TelegramUserInput,
): Promise<DbUser> {
  const { username: desired, name, surname } = opts;

  return db.transaction(async (tx) => {
    let existing = await tx.query.users.findFirst({
      where: eq(users.telegram_id, telegramId),
    });

    const needsClaim = existing?.username !== desired;
    if (needsClaim) {
      await tx
        .update(users)
        .set({ username: sql`'user_' || ${users.telegram_id}` })
        .where(
          and(
            eq(users.username, desired),
            isNotNull(users.telegram_id),
            existing ? ne(users.id, existing.id) : sql`true`,
          ),
        );
    }

    if (!existing) {
      [existing] = await tx
        .insert(users)
        .values({
          telegram_id: telegramId,
          username: desired,
          name,
          surname,
        })
        .onConflictDoUpdate({
          target: users.telegram_id,
          set: { username: desired },
        })
        .returning();

      if (!existing) {
        throw new Error('Не удалось создать пользователя');
      }
    } else if (existing.username !== desired) {
      await tx
        .update(users)
        .set({ username: desired })
        .where(eq(users.id, existing.id));
      existing.username = desired;
    }

    await tx
      .insert(userIdentities)
      .values({
        userId: existing.id,
        provider: 'telegram',
        providerId: telegramId,
      })
      .onConflictDoNothing({
        target: [userIdentities.provider, userIdentities.providerId],
      });

    return existing;
  });
}

/**
 * Разрешает пользователя по аргументу команды: `@username` ищет по `username`
 * (только среди строк с непустым `telegram_id`), иначе значение трактуется как
 * `telegram_id`. Возвращает `undefined`, если пользователь не найден.
 */
export async function findUserByHandle(
  handle: string,
): Promise<DbUser | undefined> {
  if (handle.startsWith('@')) {
    return db.query.users.findFirst({
      where: and(
        eq(users.username, handle.slice(1)),
        isNotNull(users.telegram_id),
      ),
    });
  }
  return db.query.users.findFirst({
    where: eq(users.telegram_id, handle),
  });
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
 * Identity-строки (`user_identities`) удаляются явно: строка `users` не удаляется,
 * поэтому FK `ON DELETE CASCADE` не срабатывает, а висячая identity дала бы конфликт
 * по UNIQUE(provider, provider_id) при повторном входе того же telegram-аккаунта.
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
    await tx
      .delete(userIdentities)
      .where(eq(userIdentities.userId, userId));

    // Обрываем активные wizard/диалоговые сессии этого telegram-аккаунта.
    if (existing?.telegram_id != null) {
      await tx
        .delete(dialogSessions)
        .where(eq(dialogSessions.key, existing.telegram_id));
    }
  });
}

/** Ошибка слияния аккаунтов — текст пригоден для показа пользователю. */
export class MergeError extends Error {}

/**
 * Сливает email-аккаунт (`losingId`) в Telegram-аккаунт (`survivorId`): survivor
 * остаётся, вся история (турниры, матчи, судейство, уведомления) и email-identity
 * losing переезжают на него, а losing тумбстонится (как в {@link anonymizeUser} —
 * строку не удаляем, чтобы все FK остались валидны). Необратимо. Вызывать ТОЛЬКО
 * после доказательства владения обоими аккаунтами (см. POST /telegram/merge).
 *
 * Направление выбрано так, что перепривязываются строки лишь с почти пустого
 * email-аккаунта, а `telegram_id` не двигается — значит нет username-claim и нет
 * гонки с `authMiddleware` бота (он апсертит по `telegram_id`).
 *
 * Бросает {@link MergeError} (инвариант нарушен), если: аккаунты совпадают; любой
 * из них недоступен/soft-deleted; у survivor нет `telegram_id`; у survivor уже есть
 * email-identity (перетёрли бы email входа); аккаунты играли друг против друга
 * (матч стал бы игрой с самим собой). Всё в одной транзакции.
 */
export async function mergeAccountIntoTelegram(
  survivorId: UUID,
  losingId: UUID,
): Promise<DbUser> {
  if (survivorId === losingId) {
    throw new MergeError('Нельзя слить аккаунт сам с собой.');
  }

  return db.transaction(async (tx) => {
    const survivor = await tx.query.users.findFirst({
      where: eq(users.id, survivorId),
    });
    const losing = await tx.query.users.findFirst({
      where: eq(users.id, losingId),
    });
    if (!survivor || !losing) {
      throw new MergeError('Один из аккаунтов недоступен.');
    }
    if (survivor.deletedAt !== null) {
      throw new MergeError('Аккаунт назначения недоступен.');
    }
    if (losing.deletedAt !== null) {
      throw new MergeError('Исходный аккаунт недоступен.');
    }
    if (survivor.telegram_id === null) {
      throw new MergeError('У аккаунта назначения не привязан Telegram.');
    }

    // У survivor не должно быть своей email-identity — иначе перетёрли бы email,
    // которым он входит.
    const survivorEmailIdentity = await tx.query.userIdentities.findFirst({
      where: and(
        eq(userIdentities.userId, survivorId),
        eq(userIdentities.provider, 'email'),
      ),
    });
    if (survivorEmailIdentity) {
      throw new MergeError('К аккаунту назначения уже привязана почта.');
    }

    // Аккаунты не должны были играть друг против друга: после перепривязки такой
    // матч стал бы игрой с самим собой. Честнее отказать, чем молча портить историю.
    const [headToHead] = await tx
      .select({ id: matches.id })
      .from(matches)
      .where(
        or(
          and(
            eq(matches.player1Id, survivorId),
            eq(matches.player2Id, losingId),
          ),
          and(
            eq(matches.player1Id, losingId),
            eq(matches.player2Id, survivorId),
          ),
        ),
      )
      .limit(1);
    if (headToHead) {
      throw new MergeError(
        'Аккаунты играли друг против друга — слияние невозможно.',
      );
    }

    // 1. Композитные PK (участники/судьи): где есть оба — удаляем строку losing
    // (иначе дубль PK при перепривязке), остальные переносим на survivor.
    for (const junction of [tournamentParticipants, tournamentReferees]) {
      const survivorRows = await tx
        .select({ tournamentId: junction.tournamentId })
        .from(junction)
        .where(eq(junction.userId, survivorId));
      const survivorTournamentIds = survivorRows.map((r) => r.tournamentId);
      if (survivorTournamentIds.length > 0) {
        await tx
          .delete(junction)
          .where(
            and(
              eq(junction.userId, losingId),
              inArray(junction.tournamentId, survivorTournamentIds),
            ),
          );
      }
      await tx
        .update(junction)
        .set({ userId: survivorId })
        .where(eq(junction.userId, losingId));
    }

    // 2. Прямая перепривязка (суррогатные PK — коллизий нет). Учитываем ВСЕ
    // колонки-ссылки на users.id, включая нестандартно названные (player*_id, *_by).
    await tx
      .update(matches)
      .set({ player1Id: survivorId })
      .where(eq(matches.player1Id, losingId));
    await tx
      .update(matches)
      .set({ player2Id: survivorId })
      .where(eq(matches.player2Id, losingId));
    await tx
      .update(matches)
      .set({ winnerId: survivorId })
      .where(eq(matches.winnerId, losingId));
    await tx
      .update(matches)
      .set({ reportedBy: survivorId })
      .where(eq(matches.reportedBy, losingId));
    await tx
      .update(matches)
      .set({ confirmedBy: survivorId })
      .where(eq(matches.confirmedBy, losingId));

    await tx
      .update(disqualifications)
      .set({ userId: survivorId })
      .where(eq(disqualifications.userId, losingId));
    await tx
      .update(disqualifications)
      .set({ disqualifiedBy: survivorId })
      .where(eq(disqualifications.disqualifiedBy, losingId));

    await tx
      .update(matchCorrections)
      .set({ correctedBy: survivorId })
      .where(eq(matchCorrections.correctedBy, losingId));
    await tx
      .update(matchCorrections)
      .set({ previousWinnerId: survivorId })
      .where(eq(matchCorrections.previousWinnerId, losingId));
    await tx
      .update(matchCorrections)
      .set({ newWinnerId: survivorId })
      .where(eq(matchCorrections.newWinnerId, losingId));

    await tx
      .update(notifications)
      .set({ userId: survivorId })
      .where(eq(notifications.userId, losingId));

    await tx
      .update(tournaments)
      .set({ createdBy: survivorId })
      .where(eq(tournaments.createdBy, losingId));

    // 3. Переносим email-identity на survivor (у него email-identity нет — см. выше,
    // коллизии по (user_id, provider) не будет). Делаем ДО тумбстона, иначе удаление
    // identity-строк losing затронуло бы её.
    await tx
      .update(userIdentities)
      .set({ userId: survivorId })
      .where(
        and(
          eq(userIdentities.userId, losingId),
          eq(userIdentities.provider, 'email'),
        ),
      );

    // Проставляем email/роль на survivor: email — если пуст; роль — поднимаем до
    // admin, чтобы слияние не разжаловало админа.
    const survivorPatch: Partial<typeof users.$inferInsert> = {};
    if (survivor.email === null && losing.email !== null) {
      survivorPatch.email = losing.email;
    }
    if (losing.role === 'admin' && survivor.role !== 'admin') {
      survivorPatch.role = 'admin';
    }
    if (Object.keys(survivorPatch).length > 0) {
      await tx.update(users).set(survivorPatch).where(eq(users.id, survivorId));
    }

    // 4. Тумбстон losing (как anonymizeUser): PII затираем, deletedAt ставим,
    // остаточные identity/логин-токены удаляем. У email-аккаунта нет telegram_id,
    // поэтому dialogSessions по нему не ключуются — чистить нечего.
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
      .where(eq(users.id, losingId));
    await tx.delete(loginTokens).where(eq(loginTokens.userId, losingId));
    await tx.delete(userIdentities).where(eq(userIdentities.userId, losingId));

    const merged = await tx.query.users.findFirst({
      where: eq(users.id, survivorId),
    });
    if (!merged) throw new Error('Survivor исчез после слияния');
    return merged;
  });
}
