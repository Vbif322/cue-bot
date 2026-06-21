import {
  boolean,
  integer,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { UUID } from 'crypto';

import {
  createdAt,
  enumCheck,
  prodSchema,
  updatedAt,
} from '../schemaHelpers.js';
import { users } from './users.js';
import { venues } from './venues.js';

export { formats, type ITournamentFormat } from '../../admin/server/formats.js';
import { formats } from '../../admin/server/formats.js';
import type { ITournamentFormat } from '../../admin/server/formats.js';
export {
  maxParticipants,
  winScores,
  mergeRounds,
  groupDraws,
  groupsCountOptions,
  participantsPerGroupOptions,
  validMergeRoundsForSize,
  validateGroupConfig,
  qualifiersOptionsForGroupSize,
  type ITournamentMaxParticipants,
  type ITournamentWinScore,
  type ITournamentMergeRound,
  type IGroupDraw,
  type GroupConfig,
} from '../../admin/server/tournamentOptions.js';
import { groupDraws } from '../../admin/server/tournamentOptions.js';
import type {
  IGroupDraw,
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

export const tournaments = prodSchema.table(
  'tournaments',
  {
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
    randomAdvancement: boolean('random_advancement').notNull().default(false),
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
    // SE/DE/RR use the discrete enum values; groups_playoff stores the derived
    // total (groupsCount × participantsPerGroup), so the column is a plain integer.
    maxParticipants: integer('max_participants').notNull().default(16),
    winScore: integer('win_score')
      .$type<ITournamentWinScore>()
      .notNull()
      .default(3),
    // Double elimination: after which upper-bracket round the losers bracket merges
    // back into a single-elimination playoff. 2 = current/default scheme, k = full
    // double elimination (no bracket reset). Ignored for other formats.
    mergeRound: integer('merge_round').notNull().default(2),
    // Groups + playoff config. Null for every other format.
    groupsCount: integer('groups_count'),
    participantsPerGroup: integer('participants_per_group'),
    qualifiersPerGroup: integer('qualifiers_per_group'),
    groupDraw: varchar('group_draw', { enum: groupDraws }).$type<IGroupDraw>(),
    rules: text(),
    inviteCode: varchar('invite_code', { length: 16 }).unique(),
    createdBy: uuid('created_by')
      .$type<UUID>()
      .notNull()
      .references(() => users.id),
    createdAt,
    updatedAt,
  },
  (t) => [
    enumCheck('tournaments_discipline_check', t.discipline, disciplines),
    enumCheck('tournaments_format_check', t.format, formats),
    enumCheck('tournaments_status_check', t.status, statuses),
    enumCheck('tournaments_visibility_check', t.visibility, visibilities),
    enumCheck('tournaments_schedule_mode_check', t.scheduleMode, scheduleModes),
    enumCheck('tournaments_group_draw_check', t.groupDraw, groupDraws),
  ],
);
