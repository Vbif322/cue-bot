import { integer, timestamp, varchar } from "drizzle-orm/pg-core";
import { prodSchema } from "../schemaHelpers.js";

export const loginCodes = prodSchema.table("login_codes", {
  username: varchar({ length: 255 }).primaryKey(),
  code: varchar({ length: 6 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
});
