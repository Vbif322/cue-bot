import { asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/db.js';
import { tables, tournamentTables } from '../db/schema.js';

export type Table = typeof tables.$inferSelect;

/**
 * Извлекает все столы из базы данных и возвращает их в порядке возрастания по имени
 *
 * @returns promise с массивом столов
 */
export async function getTables(): Promise<Table[]> {
  return db.query.tables.findMany({ orderBy: [asc(tables.name)] });
}

/**
 * Извлекает все столы, принадлежащие данной площадке
 *
 * @param venueId - идентификатор площадки, к которой принадлежат столы
 * @returns promise с массивом столов
 */
export async function getTablesByVenue(venueId: string): Promise<Table[]> {
  return db.query.tables.findMany({
    where: eq(tables.venueId, venueId),
    orderBy: [asc(tables.name)],
  });
}

/**
 * Извлекает стол по его идентификатору
 *
 * @param id - идентификатор извлекаемого стола
 * @returns promise с извлеченным столом или null
 */
export async function getTable(id: string): Promise<Table | null> {
  return (
    (await db.query.tables.findFirst({ where: eq(tables.id, id) })) ?? null
  );
}

/**
 * Создает новый стол с заданным названием и идентификатором площадки
 *
 * @param name - имя стола, который нужно создать
 * @param venueId - идентификатор площадки, к которой принадлежит стол
 * @returns promise с созданным столом
 */
export async function createTable(
  name: string,
  venueId: string,
): Promise<Table> {
  const [table] = await db.insert(tables).values({ name, venueId }).returning();

  return table!;
}

/**
 * Удаляет стол по его идентификатору
 *
 * @param id - идентификатор удаляемого стола
 * @returns promise с результатом удаления
 */
export async function deleteTable(id: string): Promise<boolean> {
  const [row] = await db
    .delete(tables)
    .where(eq(tables.id, id))
    .returning({ id: tables.id });

  return !!row;
}

/**
 * Возвращает столы, принадлежащие данному турниру
 *
 * @param tournamentId - идентификатор турнира
 * @returns promise с массивом столов
 */

export async function getTournamentTables(
  tournamentId: string,
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
 * @param tournamentId - идентификатор турнира
 * @param tableIds - массив идентификаторов столов
 * @returns promise без результата
 */
export async function setTournamentTables(
  tournamentId: string,
  tableIds: string[],
): Promise<void> {
  const uniqueTableIds = Array.from(new Set(tableIds));

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
 * @throws {Error} если один или несколько столов не найдены
 * @throws {Error} если не все столы принадлежат данной площадке
 *
 * @param {string[]} tableIds - массив идентификаторов столов
 * @param {string} venueId - идентификатор площадки
 *
 * @returns promise без результата
 */
export async function validateTableIdsForVenue(
  tableIds: string[],
  venueId: string,
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
