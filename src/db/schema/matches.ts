import {
  boolean,
  index,
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
  nonNegativeCheck,
  prodSchema,
  updatedAt,
} from '../schemaHelpers.js';
import { tournaments } from './tournaments.js';
import { users } from './users.js';
import { tables } from './tables.js';

export const matchStatuses = [
  'scheduled',
  'in_progress',
  'pending_confirmation',
  'completed',
  'cancelled',
] as const;

export type MatchStatus = (typeof matchStatuses)[number];

// Tournament phase a match belongs to. 'playoff' is the default so every existing
// row and every single/double-elim/round-robin match (which has a single bracket)
// stays correct without a backfill. Only the groups_playoff format reads 'group'.
export const matchPhases = ['group', 'playoff'] as const;

export type MatchPhase = (typeof matchPhases)[number];

export const matches = prodSchema.table(
  'matches',
  {
    id: uuid('id').$type<UUID>().primaryKey().defaultRandom(),
    tournamentId: uuid('tournament_id')
      .$type<UUID>()
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    round: integer().notNull(),
    position: integer().notNull(),
    player1Id: uuid('player1_id')
      .$type<UUID>()
      .references(() => users.id),
    player2Id: uuid('player2_id')
      .$type<UUID>()
      .references(() => users.id),
    player1IsWalkover: boolean('player1_is_walkover').notNull().default(false),
    player2IsWalkover: boolean('player2_is_walkover').notNull().default(false),
    winnerId: uuid('winner_id')
      .$type<UUID>()
      .references(() => users.id),
    player1Score: integer('player1_score'),
    player2Score: integer('player2_score'),
    status: varchar({ enum: matchStatuses }).notNull().default('scheduled'),
    scheduledAt: timestamp('scheduled_at'),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    reportedBy: uuid('reported_by')
      .$type<UUID>()
      .references(() => users.id),
    confirmedBy: uuid('confirmed_by')
      .$type<UUID>()
      .references(() => users.id),
    isTechnicalResult: boolean('is_technical_result').notNull().default(false),
    technicalReason: text('technical_reason'),
    isCorrected: boolean('is_corrected').notNull().default(false),
    correctionReason: text('correction_reason'),
    nextMatchId: uuid('next_match_id').$type<UUID>(),
    nextMatchPosition: varchar('next_match_position', { length: 10 }),
    bracketType: varchar({ length: 20 }).default('winners'),
    // Group stage vs playoff. Defaults to 'playoff' so all other formats are
    // unaffected; group-stage rows are written with 'group' + a groupIndex.
    phase: varchar({ enum: matchPhases }).notNull().default('playoff'),
    groupIndex: integer('group_index'),
    losersNextMatchPosition: integer('losers_next_match_position'),
    losersNextMatchSlot: varchar('losers_next_match_slot', { length: 10 }),
    tableId: uuid('table_id')
      .$type<UUID>()
      .references(() => tables.id, {
        onDelete: 'set null',
      }),
    createdAt,
    updatedAt,
  },
  (table) => [
    index('matches_tournament_id_idx').on(table.tournamentId),
    enumCheck('matches_status_check', table.status, matchStatuses),
    enumCheck('matches_phase_check', table.phase, matchPhases),
    nonNegativeCheck('matches_round_nonneg', table.round),
    nonNegativeCheck('matches_position_nonneg', table.position),
    nonNegativeCheck('matches_player1_score_nonneg', table.player1Score),
    nonNegativeCheck('matches_player2_score_nonneg', table.player2Score),
    nonNegativeCheck('matches_group_index_nonneg', table.groupIndex),
    nonNegativeCheck(
      'matches_losers_next_position_nonneg',
      table.losersNextMatchPosition,
    ),
  ],
);
