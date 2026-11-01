import {
  and,
  asc,
  count,
  eq,
  getTableColumns,
  inArray,
  isNull,
  or,
} from 'drizzle-orm';
import type { UUID } from 'crypto';

import { db } from '../db/db.js';
import { tables, venues } from '../db/schema.js';
import type { ApiVenue, Venue } from '../bot/@types/venue.js';
import { normalizeCity } from '../shared/city.js';
import type { ActorScope } from './authz.js';

export interface VenueListOptions {
  /**
   * Скоуп актора: платформенный админ (`all`) видит все площадки, организатор —
   * общие (`federationId IS NULL`) плюс площадки своих федераций.
   */
  scope?: ActorScope;
  /**
   * Площадки, пригодные для турнира конкретной федерации: общие + её
   * собственные. `null` — только общие (платформенный турнир).
   */
  federationId?: UUID | null;
}

function venueWhere(options: VenueListOptions | undefined) {
  if (!options) return undefined;
  const clauses = [];
  if (options.scope?.kind === 'federations') {
    clauses.push(
      options.scope.ids.length > 0
        ? or(
            isNull(venues.federationId),
            inArray(venues.federationId, options.scope.ids),
          )
        : isNull(venues.federationId),
    );
  }
  if (options.federationId !== undefined) {
    clauses.push(
      options.federationId === null
        ? isNull(venues.federationId)
        : or(
            isNull(venues.federationId),
            eq(venues.federationId, options.federationId),
          ),
    );
  }
  if (clauses.length === 0) return undefined;
  return and(...clauses);
}

/**
 * Список площадок с количеством столов, отфильтрованный по скоупу актора.
 *
 * @returns {Promise<ApiVenue[]>} Массив заведений с дополнительным полем `tablesCount`
 */
export async function getVenues(
  options?: VenueListOptions,
): Promise<ApiVenue[]> {
  const rows = await db
    .select({
      ...getTableColumns(venues),
      tablesCount: count(tables.id).mapWith(Number),
    })
    .from(venues)
    .leftJoin(tables, eq(tables.venueId, venues.id))
    .where(venueWhere(options))
    .groupBy(venues.id)
    .orderBy(asc(venues.name));

  return rows as unknown as ApiVenue[];
}

/**
 * Получает площадку по ее идентификатору с количеством столов
 *
 * @param {UUID} id Идентификатор площадки
 *
 * @returns {Promise<ApiVenue | null>} Найденное заведение с полем `tablesCount` или null, если не найдено
 */
export async function getVenue(id: UUID): Promise<ApiVenue | null> {
  const rows = await db
    .select({
      ...getTableColumns(venues),
      tablesCount: count(tables.id).mapWith(Number),
    })
    .from(venues)
    .leftJoin(tables, eq(tables.venueId, venues.id))
    .where(eq(venues.id, id))
    .groupBy(venues.id);

  return (rows[0] as unknown as ApiVenue | undefined) ?? null;
}

/**
 * Создает новую площадку. `federationId: null` — общая (платформенная) площадка.
 *
 * @throws {Error} Если город пустой или длиннее лимита.
 */
export async function createVenue(data: {
  name: string;
  address: string;
  city: string;
  image?: string | undefined;
  federationId: UUID | null;
}): Promise<ApiVenue> {
  const city = normalizeCity(data.city);
  if (city === null) throw new Error('Укажите город');
  const [venue] = await db
    .insert(venues)
    .values({
      name: data.name,
      address: data.address,
      city,
      image: data.image,
      federationId: data.federationId,
    })
    .returning();
  if (!venue) throw new Error('Failed to insert venue');
  const created = await getVenue(venue.id);
  if (!created) throw new Error('Failed to retrieve created venue');
  return created;
}

/**
 * Обновляет данные площадки по идентификатору. Владелец (`federationId`) не меняется.
 *
 * @throws {Error} Если город пустой или длиннее лимита.
 */
export async function updateVenue(
  id: UUID,
  data: {
    name?: string | undefined;
    address?: string | undefined;
    city?: string | undefined;
    image?: string | null | undefined;
  },
): Promise<Venue | null> {
  const patch: Partial<typeof venues.$inferInsert> = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.address !== undefined) patch.address = data.address;
  if (data.image !== undefined) patch.image = data.image;
  if (data.city !== undefined) {
    const city = normalizeCity(data.city);
    if (city === null) throw new Error('Укажите город');
    patch.city = city;
  }
  const [venue] = await db
    .update(venues)
    .set(patch)
    .where(eq(venues.id, id))
    .returning();
  return venue ?? null;
}

/**
 * Удаляет площадку по ее идентификатору
 *
 * @param {UUID} id Идентификатор площадки
 *
 * @returns {Promise<boolean>} true, если площадка была удалена, иначе false
 */
export async function deleteVenue(id: UUID): Promise<boolean> {
  const [row] = await db
    .delete(venues)
    .where(eq(venues.id, id))
    .returning({ id: venues.id });
  return !!row;
}
