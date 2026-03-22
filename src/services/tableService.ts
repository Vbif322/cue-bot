import { asc, eq, inArray } from "drizzle-orm";
import { db } from "../db/db.js";
import { tables, tournamentTables } from "../db/schema.js";

export type Table = typeof tables.$inferSelect;

export async function getTables(): Promise<Table[]> {
  return db.query.tables.findMany({ orderBy: [asc(tables.name)] });
}

export async function getTablesByVenue(venueId: string): Promise<Table[]> {
  return db.query.tables.findMany({
    where: eq(tables.venueId, venueId),
    orderBy: [asc(tables.name)],
  });
}

export async function getTable(id: string): Promise<Table | null> {
  return (await db.query.tables.findFirst({ where: eq(tables.id, id) })) ?? null;
}

export async function createTable(name: string, venueId: string): Promise<Table> {
  const [table] = await db
    .insert(tables)
    .values({ name, venueId })
    .returning();
  return table!;
}

export async function deleteTable(id: string): Promise<boolean> {
  const [row] = await db
    .delete(tables)
    .where(eq(tables.id, id))
    .returning({ id: tables.id });
  return !!row;
}

export async function getTournamentTables(tournamentId: string): Promise<Table[]> {
  const rows = await db
    .select({ table: tables })
    .from(tournamentTables)
    .innerJoin(tables, eq(tournamentTables.tableId, tables.id))
    .where(eq(tournamentTables.tournamentId, tournamentId))
    .orderBy(asc(tournamentTables.position));

  return rows.map((r) => r.table);
}

export async function setTournamentTables(
  tournamentId: string,
  tableIds: string[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(tournamentTables)
      .where(eq(tournamentTables.tournamentId, tournamentId));

    if (tableIds.length > 0) {
      await tx.insert(tournamentTables).values(
        tableIds.map((tableId, i) => ({ tournamentId, tableId, position: i })),
      );
    }
  });
}

export async function validateTableIdsForVenue(
  tableIds: string[],
  venueId: string,
): Promise<void> {
  if (tableIds.length === 0) {
    return;
  }

  if (new Set(tableIds).size !== tableIds.length) {
    throw new Error("Список столов содержит дубликаты");
  }

  const rows = await db
    .select({
      id: tables.id,
      venueId: tables.venueId,
    })
    .from(tables)
    .where(inArray(tables.id, tableIds));

  if (rows.length !== tableIds.length) {
    throw new Error("Один или несколько столов не найдены");
  }

  if (rows.some((row) => row.venueId !== venueId)) {
    throw new Error("Можно выбрать только столы выбранной площадки");
  }
}
