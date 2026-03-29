import { asc, eq, inArray } from 'drizzle-orm';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import { tables, tournamentTables } from '@/db/schema.js';

export type Table = typeof tables.$inferSelect;

/**
 * Извлекает все столы из базы данных и возвращает их в порядке возрастания по имени
 *
 * @returns {Promise<Table[]>} Массив столов
 */
export async function getTables(): Promise<Table[]> {
  return db.query.tables.findMany({ orderBy: [asc(tables.name)] });
}

/**
 * Извлекает все столы, принадлежащие данной площадке
 *
 * @param {UUID} venueId Идентификатор площадки, к которой принадлежат столы
 * @returns {Promise<Table[]>} Массив столов
 */
export async function getTablesByVenue(venueId: UUID): Promise<Table[]> {
  return db.query.tables.findMany({
    where: eq(tables.venueId, venueId),
    orderBy: [asc(tables.name)],
  });
}

/**
 * Извлекает стол по его идентификатору
 *
 * @param {UUID} id Идентификатор извлекаемого стола
 * @returns {Promise<Table | null>} Стол или null
 */
export async function getTable(id: UUID): Promise<Table | null> {
  return (
    (await db.query.tables.findFirst({ where: eq(tables.id, id) })) ?? null
  );
}

/**
 * Создает новый стол с заданным названием и идентификатором площадки
 *
 * @param {string} name Название стола, который нужно создать
 * @param {UUID} venueId Идентификатор площадки, к которой принадлежит стол
 * @returns {Promise<Table>} Созданный стол
 */
export async function createTable(name: string, venueId: UUID): Promise<Table> {
  const [table] = await db.insert(tables).values({ name, venueId }).returning();

  return table!;
}

/**
 * Удаляет стол по его идентификатору
 *
 * @param {UUID} id Идентификатор удаляемого стола
 * @returns {Promise<boolean>} true, если стол был удален, иначе false
 */
export async function deleteTable(id: UUID): Promise<boolean> {
  const [row] = await db
    .delete(tables)
    .where(eq(tables.id, id))
    .returning({ id: tables.id });

  return !!row;
}

/**
 * Возвращает столы, принадлежащие данному турниру
 *
 * @param {UUID} tournamentId Идентификатор турнира
 * @returns {Promise<Table[]>} Массив столов
 */

export async function getTournamentTables(
  tournamentId: UUID,
): Promise<Table[]> {
  const rows = await db
    .select({ table: tables })
    .from(tournamentTables)
    .innerJoin(tables, eq(tournamentTables.tableId, tables.id))
    .where(eq(tournamentTables.tournamentId, tournamentId))
    .orderBy(asc(tournamentTables.position));

  return rows.map((r) => r.table);
}

/**
 * Переназначает столы для данного турнира
 *
 * @param {UUID} tournamentId Идентификатор турнира
 * @param {UUID[]} tableIds Массив идентификаторов столов
 * @returns {Promise<void>}
 */
export async function setTournamentTables(
  tournamentId: UUID,
  tableIds: UUID[],
): Promise<void> {
  const uniqueTableIds = Array.from(new Set(tableIds)) as UUID[];

  await db.transaction(async (tx) => {
    await tx
      .delete(tournamentTables)
      .where(eq(tournamentTables.tournamentId, tournamentId));

    if (uniqueTableIds.length > 0) {
      await tx.insert(tournamentTables).values(
        uniqueTableIds.map((tableId, i) => ({
          tournamentId,
          tableId,
          position: i,
        })),
      );
    }
  });
}

/**
 * Проверяет, что все указанные столы принадлежат данной площадке
 *
 * @throws {Error} Если один или несколько столов не найдены
 * @throws {Error} Если не все столы принадлежат данной площадке
 *
 * @param {UUID[]} tableIds Массив идентификаторов столов
 * @param {UUID} venueId Идентификатор площадки
 *
 * @returns {Promise<void>}
 */
export async function validateTableIdsForVenue(
  tableIds: UUID[],
  venueId: UUID,
): Promise<void> {
  if (tableIds.length === 0) {
    return;
  }

  const uniqueTableIds = Array.from(new Set(tableIds));

  const rows = await db
    .select({
      id: tables.id,
      venueId: tables.venueId,
    })
    .from(tables)
    .where(inArray(tables.id, uniqueTableIds));

  if (rows.length !== uniqueTableIds.length) {
    throw new Error('Один или несколько столов не найдены');
  }

  if (rows.some((row) => row.venueId !== venueId)) {
    throw new Error('Можно выбрать только столы выбранной площадки');
  }
}
