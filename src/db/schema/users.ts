import { date, uuid, varchar } from "drizzle-orm/pg-core";
import { prodSchema } from "../schemaHelpers.js";

export const users = prodSchema.table("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  telegram_id: varchar({ length: 255 }).notNull().unique(),
  username: varchar({ length: 255 }).notNull(),
  phone: varchar({ length: 20 }),
  email: varchar({ length: 255 }),
  name: varchar({ length: 50 }),
  surname: varchar({ length: 100 }),
  birthday: date(),
  role: varchar({ enum: ["user", "admin"] })
    .notNull()
    .default("user"),
});
