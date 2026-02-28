import { timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { createdAt, prodSchema } from "../schemaHelpers.js";
import { users } from "./users.js";

export const loginTokens = prodSchema.table("login_tokens", {
  token: varchar({ length: 32 }).primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt,
});
