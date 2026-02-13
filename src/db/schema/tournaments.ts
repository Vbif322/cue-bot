import { integer, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { createdAt, prodSchema, updatedAt } from "../schemaHelpers.js";
import { users } from "./users.js";

export const tournamentStatus = [
  "draft",
  "registration_open",
  "registration_closed",
  "in_progress",
  "completed",
  "cancelled",
] as const;

export const tournamentFormat = [
  "single_elimination",
  "double_elimination",
  "round_robin",
] as const;

export const discipline = [
  // "pool",
  "snooker",
  // "russian_billiards",
  // "carom",
] as const;

export const tournaments = prodSchema.table("tournaments", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar({ length: 255 }).notNull(),
  description: text(),
  discipline: varchar({ enum: discipline }).notNull(),
  format: varchar({ enum: tournamentFormat }).notNull(),
  status: varchar({ enum: tournamentStatus }).notNull().default("draft"),
  startDate: timestamp("start_date"),
  confirmedParticipants: integer("confirmed_participants"),
  maxParticipants: integer("max_participants").notNull().default(16),
  winScore: integer("win_score").notNull().default(3),
  rules: text(),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdAt,
  updatedAt,
});
