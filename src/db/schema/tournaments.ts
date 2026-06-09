import { integer, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import type { UUID } from 'crypto';

import { createdAt, prodSchema, updatedAt } from '../schemaHelpers.js';
import { users } from './users.js';
import { venues } from './venues.js';

export { formats, type ITournamentFormat } from '../../admin/server/formats.js';
import { formats } from '../../admin/server/formats.js';
import type { ITournamentFormat } from '../../admin/server/formats.js';
export {
  maxParticipants,
  winScores,
  type ITournamentMaxParticipants,
  type ITournamentWinScore,
} from '../../admin/server/tournamentOptions.js';
import type {
  ITournamentMaxParticipants,
  ITournamentWinScore,
} from '../../admin/server/tournamentOptions.js';

export const statuses = [
  'draft',
  'registration_open',
  'registration_closed',
  'in_progress',
  'completed',
  'cancelled',
] as const;

export type ITournamentStatus = (typeof statuses)[number];

export const disciplines = [
  // "pool",
  'snooker',
  // "russian_billiards",
  // "carom",
] as const;

export type ITournamentDiscipline = (typeof disciplines)[number];

export const visibilities = ['public', 'private'] as const;

export type ITournamentVisibility = (typeof visibilities)[number];

export const scheduleModes = ['single_day', 'per_match'] as const;

export type ITournamentScheduleMode = (typeof scheduleModes)[number];

export const tournaments = prodSchema.table('tournaments', {
  id: uuid('id').$type<UUID>().primaryKey().defaultRandom(),
  venueId: uuid('venue_id')
    .$type<UUID>()
    .notNull()
    .references(() => venues.id),

  name: varchar({ length: 255 }).notNull(),
  description: text(),
  discipline: varchar({ enum: disciplines })
    .$type<ITournamentDiscipline>()
    .notNull(),
  format: varchar({ enum: formats }).$type<ITournamentFormat>().notNull(),
  status: varchar({ enum: statuses })
    .$type<ITournamentStatus>()
    .notNull()
    .default('draft'),
  visibility: varchar({ enum: visibilities })
    .$type<ITournamentVisibility>()
    .notNull()
    .default('public'),
  scheduleMode: varchar('schedule_mode', { enum: scheduleModes })
    .$type<ITournamentScheduleMode>()
    .notNull()
    .default('single_day'),
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
  inviteCode: varchar('invite_code', { length: 16 }).unique(),
  createdBy: uuid('created_by')
    .$type<UUID>()
    .notNull()
    .references(() => users.id),
  createdAt,
  updatedAt,
});
