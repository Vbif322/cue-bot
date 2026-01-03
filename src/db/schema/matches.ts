import {
  boolean,
  integer,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { createdAt, prodSchema, updatedAt } from "../schemaHelpers.js";
import { tournaments } from "./tournaments.js";
import { users } from "./users.js";

export const matchStatus = [
  "scheduled",
  "in_progress",
  "pending_confirmation",
  "completed",
  "cancelled",
] as const;

export const matches = prodSchema.table("matches", {
  id: uuid("id").primaryKey().defaultRandom(),
  tournamentId: uuid("tournament_id")
    .notNull()
    .references(() => tournaments.id, { onDelete: "cascade" }),
  round: integer().notNull(),
  position: integer().notNull(),
  player1Id: uuid("player1_id").references(() => users.id),
  player2Id: uuid("player2_id").references(() => users.id),
  winnerId: uuid("winner_id").references(() => users.id),
  player1Score: integer("player1_score"),
  player2Score: integer("player2_score"),
  status: varchar({ enum: matchStatus }).notNull().default("scheduled"),
  scheduledAt: timestamp("scheduled_at"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  reportedBy: uuid("reported_by").references(() => users.id),
  confirmedBy: uuid("confirmed_by").references(() => users.id),
  isTechnicalResult: boolean("is_technical_result").notNull().default(false),
  technicalReason: text("technical_reason"),
  nextMatchId: uuid("next_match_id"),
  bracketType: varchar({ length: 20 }).default("winners"),
  createdAt,
  updatedAt,
});
