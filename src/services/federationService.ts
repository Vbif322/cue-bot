import { and, asc, count, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import type { Executor } from '@/db/db.js';
import {
  federationMembers,
  federations,
  tournamentParticipants,
  tournaments,
  users,
  venues,
} from '@/db/schema.js';
import type { IFederation, IFederationRole, IUserRole } from '@/db/schema.js';
import type { DbUser } from '@/bot/types.js';
import { normalizeCity } from '@/shared/city.js';

/**
 * Федерации (организаторы) и их команды — ROADMAP M8. Импортирует только `db` и
 * схему, чтобы authz / refereeService / notificationService могли зависеть от
 * него без циклов.
 *
 * Ошибки инвариантов — `throw new Error(<русский текст>)`, как в
 * tournamentService; вызывающие показывают `errorMessage(e)`.
 */

export const MAX_NAME_LENGTH = 255;
export const MAX_DESCRIPTION_LENGTH = 2000;
/** Сколько федераций обладатель права может завести сам (защита от спама). */
export const MAX_OWNED_FEDERATIONS_PER_USER = 3;

export const FEDERATION_GRANT_REQUIRED_ERROR =
  'Создание организаций — платная опция. Обратитесь к администратору платформы.';

/**
 * Срок, до которого в федерации открыты новые турниры: максимум
 * `users.organizerUntil` её владельцев (null — права нет ни у кого). Внешняя
 * таблица — через `${federations}.id`: в коррелированном подзапросе drizzle
 * рендерит колонки без таблицы (см. listFederations).
 */
const federationActiveUntil = sql<Date | null>`(
  select max(ou.organizer_until) from ${federationMembers} om
  join ${users} ou on ou.id = om.user_id
  where om.federation_id = ${federations}.id and om.role = 'owner'
)`.mapWith(users.organizerUntil);

function grantActive(organizerUntil: Date | null, now = new Date()): boolean {
  return organizerUntil !== null && organizerUntil > now;
}

/** Федерация глазами её члена. */
export interface UserFederation {
  id: UUID;
  name: string;
  city: string;
  role: IFederationRole;
  /** До какого момента открыты новые турниры (право владельцев); null — закрыты. */
  activeUntil: Date | null;
}

/** Строка списка федераций для платформенного админа. */
export interface FederationSummary extends IFederation {
  membersCount: number;
  tournamentsCount: number;
  activeUntil: Date | null;
}

/** Публичная карточка федерации (лента игрока, фильтр по организатору). */
export interface PublicFederation {
  id: UUID;
  name: string;
  city: string;
  description: string | null;
}

export interface FederationMemberView {
  userId: UUID;
  role: IFederationRole;
  username: string;
  name: string | null;
  surname: string | null;
  telegramLinked: boolean;
  createdAt: Date;
}

export async function getUserFederations(
  userId: UUID,
): Promise<UserFederation[]> {
  return db
    .select({
      id: federations.id,
      name: federations.name,
      city: federations.city,
      role: federationMembers.role,
      activeUntil: federationActiveUntil,
    })
    .from(federationMembers)
    .innerJoin(federations, eq(federationMembers.federationId, federations.id))
    .where(eq(federationMembers.userId, userId))
    .orderBy(asc(federations.name));
}

export async function getFederationIdsOf(userId: UUID): Promise<UUID[]> {
  const rows = await db
    .select({ federationId: federationMembers.federationId })
    .from(federationMembers)
    .where(eq(federationMembers.userId, userId));
  return rows.map((r) => r.federationId);
}

/** Роль пользователя в федерации или null, если он в ней не состоит. */
export async function getMembership(
  userId: UUID,
  federationId: UUID,
): Promise<IFederationRole | null> {
  const [row] = await db
    .select({ role: federationMembers.role })
    .from(federationMembers)
    .where(
      and(
        eq(federationMembers.federationId, federationId),
        eq(federationMembers.userId, userId),
      ),
    )
    .limit(1);
  return row?.role ?? null;
}

/**
 * «Staff» — тот, кому открыт вход в панель управления: платформенный админ,
 * обладатель действующего права организатора или член хотя бы одной федерации
 * (даже с истёкшей подпиской — чтобы доиграть текущие турниры).
 */
export async function isStaffUser(user: {
  id: UUID;
  role: IUserRole;
  organizerUntil: Date | null;
}): Promise<boolean> {
  if (user.role === 'admin' || grantActive(user.organizerUntil)) return true;
  const [row] = await db
    .select({ federationId: federationMembers.federationId })
    .from(federationMembers)
    .where(eq(federationMembers.userId, user.id))
    .limit(1);
  return row !== undefined;
}

function validateName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length === 0) throw new Error('Укажите название');
  if (name.length > MAX_NAME_LENGTH) {
    throw new Error(`Название не длиннее ${String(MAX_NAME_LENGTH)} символов`);
  }
  return name;
}

function validateDescription(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const text = raw.trim();
  if (text.length === 0) return null;
  if (text.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error(
      `Описание не длиннее ${String(MAX_DESCRIPTION_LENGTH)} символов`,
    );
  }
  return text;
}

export interface CreateFederationInput {
  name: string;
  city: string;
  description?: string | null;
  /** Становится `owner`. */
  ownerId: UUID;
  /** Кто создал запись (платформенный админ может завести федерацию для другого). */
  createdBy?: UUID;
  /**
   * Самообслуживание (владелец создаёт сам): у `ownerId` должно действовать
   * право организатора, и число его федераций ограничено
   * {@link MAX_OWNED_FEDERATIONS_PER_USER}. Платформенный админ, заводящий
   * федерацию (себе или другому), передаёт false.
   */
  selfService?: boolean;
}

/** Создаёт федерацию и её первого владельца одной транзакцией. */
export async function createFederation(
  input: CreateFederationInput,
): Promise<IFederation> {
  const name = validateName(input.name);
  const city = normalizeCity(input.city);
  if (city === null) throw new Error('Укажите город');
  const description = validateDescription(input.description);

  return db.transaction(async (tx) => {
    if (input.selfService) {
      const [owner] = await tx
        .select({ organizerUntil: users.organizerUntil })
        .from(users)
        .where(eq(users.id, input.ownerId))
        .limit(1);
      if (!owner || !grantActive(owner.organizerUntil)) {
        throw new Error(FEDERATION_GRANT_REQUIRED_ERROR);
      }
      const [owned] = await tx
        .select({ count: count() })
        .from(federationMembers)
        .where(
          and(
            eq(federationMembers.userId, input.ownerId),
            eq(federationMembers.role, 'owner'),
          ),
        );
      if ((owned?.count ?? 0) >= MAX_OWNED_FEDERATIONS_PER_USER) {
        throw new Error(
          `Нельзя владеть более чем ${String(MAX_OWNED_FEDERATIONS_PER_USER)} организациями`,
        );
      }
    }

    const [federation] = await tx
      .insert(federations)
      .values({
        name,
        city,
        description,
        createdBy: input.createdBy ?? input.ownerId,
      })
      .returning();
    if (!federation) throw new Error('Ошибка создания организации');

    await tx.insert(federationMembers).values({
      federationId: federation.id,
      userId: input.ownerId,
      role: 'owner',
    });

    return federation;
  });
}

export async function getFederation(id: UUID): Promise<IFederation | null> {
  const row = await db.query.federations.findFirst({
    where: eq(federations.id, id),
  });
  return row ?? null;
}

/** Все федерации с размером команды и числом турниров — для платформенного админа. */
export async function listFederations(): Promise<FederationSummary[]> {
  // Внутри коррелированного подзапроса drizzle рендерит колонки без таблицы
  // (`"id"`), и Postgres берёт их из ВНУТРЕННЕЙ области. Внешнюю таблицу
  // поэтому ссылаем явно через `${federations}.id` → "prod"."federations".id.
  const membersCount = sql<number>`(
    select count(*)::int from ${federationMembers} fm
    where fm.federation_id = ${federations}.id
  )`;
  const tournamentsCount = sql<number>`(
    select count(*)::int from ${tournaments} t
    where t.federation_id = ${federations}.id
  )`;
  return db
    .select({
      id: federations.id,
      name: federations.name,
      city: federations.city,
      description: federations.description,
      createdBy: federations.createdBy,
      createdAt: federations.createdAt,
      updatedAt: federations.updatedAt,
      membersCount,
      tournamentsCount,
      activeUntil: federationActiveUntil,
    })
    .from(federations)
    .orderBy(asc(federations.name));
}

/** См. {@link federationActiveUntil}. Null — федерации нет или права нет ни у кого. */
export async function getFederationActiveUntil(
  federationId: UUID,
): Promise<Date | null> {
  const [row] = await db
    .select({ activeUntil: federationActiveUntil })
    .from(federations)
    .where(eq(federations.id, federationId))
    .limit(1);
  return row?.activeUntil ?? null;
}

/**
 * Бросает, если в федерации закрыты новые турниры (право организатора у всех
 * владельцев истекло или не выдавалось). Текущие турниры это не затрагивает.
 */
export async function assertFederationActive(
  federationId: UUID,
): Promise<void> {
  const activeUntil = await getFederationActiveUntil(federationId);
  if (!grantActive(activeUntil)) {
    throw new Error(
      'Срок права организатора у владельцев этой организации истёк — новые ' +
        'турниры недоступны. Обратитесь к администратору платформы.',
    );
  }
}

/**
 * Выдать, продлить (`until` в будущем) или снять (`null`) право организатора.
 * Возвращает false, если пользователя нет или он удалён.
 */
export async function setOrganizerUntil(
  userId: UUID,
  until: Date | null,
): Promise<boolean> {
  const rows = await db
    .update(users)
    .set({ organizerUntil: until })
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .returning({ id: users.id });
  return rows.length > 0;
}

/** Публичный список организаторов (лента игрока), опционально по городу. */
export async function listPublicFederations(options?: {
  city?: string;
}): Promise<PublicFederation[]> {
  const city = options?.city?.trim();
  return db
    .select({
      id: federations.id,
      name: federations.name,
      city: federations.city,
      description: federations.description,
    })
    .from(federations)
    .where(city ? sql`lower(${federations.city}) = lower(${city})` : undefined)
    .orderBy(asc(federations.name));
}

export async function updateFederation(
  id: UUID,
  patch: {
    name?: string | undefined;
    city?: string | undefined;
    description?: string | null | undefined;
  },
): Promise<IFederation | null> {
  const set: Partial<typeof federations.$inferInsert> = {};
  if (patch.name !== undefined) set.name = validateName(patch.name);
  if (patch.city !== undefined) {
    const city = normalizeCity(patch.city);
    if (city === null) throw new Error('Укажите город');
    set.city = city;
  }
  if (patch.description !== undefined) {
    set.description = validateDescription(patch.description);
  }
  if (Object.keys(set).length === 0) return getFederation(id);

  const [row] = await db
    .update(federations)
    .set(set)
    .where(eq(federations.id, id))
    .returning();
  return row ?? null;
}

export type DeleteFederationOutcome =
  'deleted' | 'not_found' | 'has_references';

/**
 * Удаляет федерацию вместе с командой (cascade). Отказывает, пока на неё
 * ссылаются турниры или площадки — их надо перенести/удалить явно.
 */
export async function deleteFederation(
  id: UUID,
): Promise<DeleteFederationOutcome> {
  return db.transaction(async (tx) => {
    const [t] = await tx
      .select({ count: count() })
      .from(tournaments)
      .where(eq(tournaments.federationId, id));
    const [v] = await tx
      .select({ count: count() })
      .from(venues)
      .where(eq(venues.federationId, id));
    if ((t?.count ?? 0) > 0 || (v?.count ?? 0) > 0) return 'has_references';

    const [row] = await tx
      .delete(federations)
      .where(eq(federations.id, id))
      .returning({ id: federations.id });
    return row ? 'deleted' : 'not_found';
  });
}

export async function listMembers(
  federationId: UUID,
): Promise<FederationMemberView[]> {
  const rows = await db
    .select({
      userId: federationMembers.userId,
      role: federationMembers.role,
      username: users.username,
      name: users.name,
      surname: users.surname,
      telegramId: users.telegram_id,
      createdAt: federationMembers.createdAt,
    })
    .from(federationMembers)
    .innerJoin(users, eq(federationMembers.userId, users.id))
    .where(eq(federationMembers.federationId, federationId))
    .orderBy(asc(federationMembers.role), asc(users.username));
  return rows.map(({ telegramId, ...r }) => ({
    ...r,
    telegramLinked: telegramId !== null,
  }));
}

export type AddMemberOutcome =
  | { ok: true }
  | { ok: false; reason: 'already_member' | 'federation_not_found' };

export async function addMember(
  federationId: UUID,
  userId: UUID,
  role: IFederationRole,
): Promise<AddMemberOutcome> {
  const federation = await getFederation(federationId);
  if (!federation) return { ok: false, reason: 'federation_not_found' };

  const inserted = await db
    .insert(federationMembers)
    .values({ federationId, userId, role })
    .onConflictDoNothing()
    .returning({ userId: federationMembers.userId });
  if (inserted.length === 0) return { ok: false, reason: 'already_member' };
  return { ok: true };
}

async function ownersCount(
  executor: Executor,
  federationId: UUID,
): Promise<number> {
  const [row] = await executor
    .select({ count: count() })
    .from(federationMembers)
    .where(
      and(
        eq(federationMembers.federationId, federationId),
        eq(federationMembers.role, 'owner'),
      ),
    );
  return row?.count ?? 0;
}

/**
 * Меняет роль члена. Понизить единственного владельца нельзя — у федерации
 * всегда остаётся хотя бы один owner.
 *
 * @throws {Error} «Нельзя снять последнего владельца» / «Участник не найден».
 */
export async function setMemberRole(
  federationId: UUID,
  userId: UUID,
  role: IFederationRole,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${federationId}))`,
    );
    const current = await tx.query.federationMembers.findFirst({
      where: and(
        eq(federationMembers.federationId, federationId),
        eq(federationMembers.userId, userId),
      ),
    });
    if (!current) throw new Error('Участник не найден');
    if (current.role === role) return;
    if (
      current.role === 'owner' &&
      (await ownersCount(tx, federationId)) <= 1
    ) {
      throw new Error('Нельзя снять последнего владельца');
    }
    await tx
      .update(federationMembers)
      .set({ role })
      .where(
        and(
          eq(federationMembers.federationId, federationId),
          eq(federationMembers.userId, userId),
        ),
      );
  });
}

/**
 * Исключает члена (или он выходит сам). Последнего владельца удалить нельзя.
 *
 * @throws {Error} «Нельзя снять последнего владельца» / «Участник не найден».
 */
export async function removeMember(
  federationId: UUID,
  userId: UUID,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${federationId}))`,
    );
    const current = await tx.query.federationMembers.findFirst({
      where: and(
        eq(federationMembers.federationId, federationId),
        eq(federationMembers.userId, userId),
      ),
    });
    if (!current) throw new Error('Участник не найден');
    if (
      current.role === 'owner' &&
      (await ownersCount(tx, federationId)) <= 1
    ) {
      throw new Error('Нельзя снять последнего владельца');
    }
    await tx
      .delete(federationMembers)
      .where(
        and(
          eq(federationMembers.federationId, federationId),
          eq(federationMembers.userId, userId),
        ),
      );
  });
}

/**
 * SQL-условие «пользователь входит в ростер федераций `ids`»: участвовал в их
 * турнирах, состоит в команде или заведён ими как гость. Ростер — производный,
 * отдельной таблицы нет (см. план M8).
 */
function rosterCondition(ids: UUID[]) {
  // `${users}.id` — явная ссылка на внешнюю таблицу (см. listFederations).
  return or(
    sql`exists (
      select 1 from ${tournamentParticipants} tp
      join ${tournaments} t on t.id = tp.tournament_id
      where tp.user_id = ${users}.id and ${inArray(sql`t.federation_id`, ids)}
    )`,
    sql`exists (
      select 1 from ${federationMembers} fm
      where fm.user_id = ${users}.id and ${inArray(sql`fm.federation_id`, ids)}
    )`,
    inArray(users.createdByFederationId, ids),
  );
}

/** Активные (не удалённые) пользователи из ростера федераций, по username. */
export async function listFederationRoster(ids: UUID[]): Promise<DbUser[]> {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(users)
    .where(and(isNull(users.deletedAt), rosterCondition(ids)))
    .orderBy(asc(users.username));
}

export async function isUserInFederationRoster(
  userId: UUID,
  ids: UUID[],
): Promise<boolean> {
  if (ids.length === 0) return false;
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), rosterCondition(ids)))
    .limit(1);
  return row !== undefined;
}

/**
 * Переносит членства с `losingId` на `survivorId` (слияние аккаунтов). При
 * конфликте по PK остаётся старшая роль (owner > organizer), строка losing
 * удаляется. Выполняется внутри транзакции вызывающего.
 */
export async function transferMemberships(
  tx: Executor,
  losingId: UUID,
  survivorId: UUID,
): Promise<void> {
  const losing = await tx
    .select()
    .from(federationMembers)
    .where(eq(federationMembers.userId, losingId));
  if (losing.length === 0) return;

  const survivorRows = await tx
    .select()
    .from(federationMembers)
    .where(
      and(
        eq(federationMembers.userId, survivorId),
        inArray(
          federationMembers.federationId,
          losing.map((m) => m.federationId),
        ),
      ),
    );
  const survivorRoleByFed = new Map(
    survivorRows.map((m) => [m.federationId, m.role]),
  );

  for (const m of losing) {
    const existing = survivorRoleByFed.get(m.federationId);
    if (existing === undefined) {
      await tx
        .update(federationMembers)
        .set({ userId: survivorId })
        .where(
          and(
            eq(federationMembers.federationId, m.federationId),
            eq(federationMembers.userId, losingId),
          ),
        );
      continue;
    }
    if (existing === 'organizer' && m.role === 'owner') {
      await tx
        .update(federationMembers)
        .set({ role: 'owner' })
        .where(
          and(
            eq(federationMembers.federationId, m.federationId),
            eq(federationMembers.userId, survivorId),
          ),
        );
    }
    await tx
      .delete(federationMembers)
      .where(
        and(
          eq(federationMembers.federationId, m.federationId),
          eq(federationMembers.userId, losingId),
        ),
      );
  }
}
