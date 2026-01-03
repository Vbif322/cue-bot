import { primaryKey, uuid } from "drizzle-orm/pg-core";
import { createdAt, prodSchema } from "../schemaHelpers.js";
import { tournaments } from "./tournaments.js";
import { users } from "./users.js";

export const tournamentReferees = prodSchema.table(
  "tournament_referees",
  {
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt,
  },
  (table) => [primaryKey({ columns: [table.tournamentId, table.userId] })]
);
