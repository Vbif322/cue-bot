import { integer, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import type { UUID } from 'crypto';

import { createdAt, prodSchema, updatedAt } from '../schemaHelpers.js';
import { users } from './users.js';
import { venues } from './venues.js';

export const statuses = [
  'draft',
  'registration_open',
  'registration_closed',
  'in_progress',
  'completed',
  'cancelled',
] as const;

export type ITournamentStatus = (typeof statuses)[number];

export const formats = [
  'single_elimination',
  'double_elimination',
  'round_robin',
] as const;

export type ITournamentFormat = (typeof formats)[number];

export const disciplines = [
  // "pool",
  'snooker',
  // "russian_billiards",
  // "carom",
] as const;

export type ITournamentDiscipline = (typeof disciplines)[number];

export const maxParticipants = [8, 16, 32, 64, 128] as const;

export type ITournamentMaxParticipants = (typeof maxParticipants)[number];

export const winScores = [2, 3, 4, 5] as const;

export type ITournamentWinScore = (typeof winScores)[number];

export const tournaments = prodSchema.table('tournaments', {
  id: uuid('id').$type<UUID>().primaryKey().defaultRandom(),
  venueId: uuid('venue_id')
    .$type<UUID>()
    .notNull()
    .references(() => venues.id),

  name: varchar({ length: 255 }).notNull(),
  description: text(),
  discipline: varchar({ enum: disciplines }).notNull(),
  format: varchar({ enum: formats }).notNull(),
  status: varchar({ enum: statuses }).notNull().default('draft'),
  startDate: timestamp('start_date'),
  confirmedParticipants: integer('confirmed_participants'),
  maxParticipants: integer('max_participants')
    .$type<ITournamentMaxParticipants>()
    .notNull()
    .default(16),
  winScore: integer('win_score')
    .$type<ITournamentWinScore>()
    .notNull()
    .default(3),
  rules: text(),
  createdBy: uuid('created_by')
    .$type<UUID>()
    .notNull()
    .references(() => users.id),
  createdAt,
  updatedAt,
});
