import { integer, primaryKey, uuid, varchar } from "drizzle-orm/pg-core";
import { createdAt, prodSchema } from "../schemaHelpers.js";
import { tournaments } from "./tournaments.js";
import { users } from "./users.js";

export const participantStatus = [
  "pending",
  "confirmed",
  "cancelled",
  "disqualified",
] as const;

export const tournamentParticipants = prodSchema.table(
  "tournament_participants",
  {
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: varchar({ enum: participantStatus }).notNull().default("pending"),
    seed: integer(),
    createdAt,
  },
  (table) => [primaryKey({ columns: [table.tournamentId, table.userId] })]
);
