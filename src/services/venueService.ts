import { asc, count, eq, getTableColumns } from "drizzle-orm";
import { db } from "../db/db.js";
import { tables, venues } from "../db/schema.js";
import type { ApiVenue, Venue } from "../bot/@types/venue.js";

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

export async function getVenue(id: string): Promise<ApiVenue | null> {
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

export async function createVenue(data: {
  name: string;
  address: string;
  image?: string | undefined;
}): Promise<ApiVenue> {
  const [venue] = await db.insert(venues).values(data).returning();
  return (await getVenue(venue!.id))!;
}

export async function updateVenue(
  id: string,
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

export async function deleteVenue(id: string): Promise<boolean> {
  const [row] = await db
    .delete(venues)
    .where(eq(venues.id, id))
    .returning({ id: venues.id });
  return !!row;
}
