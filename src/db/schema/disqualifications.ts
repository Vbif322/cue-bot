import { text, uuid } from "drizzle-orm/pg-core";
import { createdAt, prodSchema } from "../schemaHelpers.js";
import { users } from "./users.js";
import { tournaments } from "./tournaments.js";

export const disqualifications = prodSchema.table("disqualifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  tournamentId: uuid("tournament_id")
    .notNull()
    .references(() => tournaments.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  reason: text().notNull(),
  disqualifiedBy: uuid("disqualified_by")
    .notNull()
    .references(() => users.id),
  createdAt,
});
