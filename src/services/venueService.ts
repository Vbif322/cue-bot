import { asc, count, eq, getTableColumns } from 'drizzle-orm';
import type { UUID } from 'crypto';

import { db } from '../db/db.js';
import { tables, venues } from '../db/schema.js';
import type { ApiVenue, Venue } from '../bot/@types/venue.js';

/**
 * Получает список площадок с количеством столов
 *
 * @returns {Promise<ApiVenue[]>} Массив заведений с дополнительным полем `tablesCount`
 */
export async function getVenues(): Promise<ApiVenue[]> {
  const rows = await db
    .select({
      ...getTableColumns(venues),
      tablesCount: count(tables.id).mapWith(Number),
    })
    .from(venues)
    .leftJoin(tables, eq(tables.venueId, venues.id))
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

  return (rows[0] as unknown as ApiVenue) ?? null;
}

/**
 * Создает новую площадку с заданными параметрами
 *
 * @param {Object} data Данные для создания
 * @param {string} data.name Название площадки
 * @param {string} data.address Адрес площадки
 * @param {string | undefined} data.image URL изображения площадки (необязательное поле)
 *
 * @returns {Promise<ApiVenue>} Созданная площадка с дополнительным полем `tablesCount`
 */
export async function createVenue(data: {
  name: string;
  address: string;
  image?: string | undefined;
}): Promise<ApiVenue> {
  const [venue] = await db.insert(venues).values(data).returning();
  return (await getVenue(venue!.id))!;
}

/**
 * Обновляет данные площадки по идентификатору
 *
 * @param {UUID} id Идентификатор площадки
 * @param {Object} data Данные для обновления
 * @param {string | undefined} data.name Название площадки (необязательное поле)
 * @param {string | undefined} data.address Адрес площадки (необязательное поле)
 * @param {string | null | undefined} data.image URL изображения площадки (необязательное поле)
 *
 * @returns {Promise<Venue | null>} Обновленная площадка или null, если не найдена
 */
export async function updateVenue(
  id: UUID,
  data: {
    name?: string | undefined;
    address?: string | undefined;
    image?: string | null | undefined;
  },
): Promise<Venue | null> {
  const [venue] = await db
    .update(venues)
    .set(data)
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
