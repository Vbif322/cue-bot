import { text, uuid, varchar } from "drizzle-orm/pg-core";
import { createdAt, prodSchema } from "../schemaHelpers.js";

export const venues = prodSchema.table("venues", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar({ length: 255 }).notNull(),
  address: text("address").notNull(),
  image: text("image"),
  createdAt,
});
