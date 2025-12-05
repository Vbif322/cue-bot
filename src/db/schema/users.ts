import { uuid, varchar } from "drizzle-orm/pg-core";
import { prodSchema } from "../schemaHelpers.js";

export const users = prodSchema.table("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  telegram_id: varchar({ length: 255 }).notNull().unique(),
  role: varchar({ enum: ["user", "admin"] })
    .notNull()
    .default("user"),
});
