import { uuid, varchar } from "drizzle-orm/pg-core";
import { createdAt, prodSchema } from "../schemaHelpers.js";
import { venues } from "./venues.js";

export const tables = prodSchema.table("tables", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar({ length: 100 }).notNull(),
  venueId: uuid("venue_id").notNull().references(() => venues.id, { onDelete: "cascade" }),
  createdAt,
});
