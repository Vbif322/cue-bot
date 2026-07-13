import { index, integer, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { UUID } from 'crypto';

import { createdAt, nonNegativeCheck, prodSchema } from '../schemaHelpers.js';
import { matches } from './matches.js';

/**
 * Per-frame detail beneath a match. Written only by the snooker frame-entry flow
 * (M2-5/M2-6/M2-7); other disciplines keep the aggregate-only report path and have
 * zero rows here. The match aggregate `player1Score`/`player2Score` (frames-won
 * counts) is an authoritative cache recomputed from these rows on every write, so
 * every existing reader (advancement, standings, cards) keeps working unchanged.
 *
 * The frame winner is derived by comparing points and is never stored. `*Break`
 * columns hold the highest break per player in that frame (snooker only; null
 * otherwise) — the match max break is derived as the max across frames.
 */
export const matchFrames = prodSchema.table(
  'match_frames',
  {
    id: uuid('id').$type<UUID>().primaryKey().defaultRandom(),
    matchId: uuid('match_id')
      .$type<UUID>()
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    frameNumber: integer('frame_number').notNull(),
    player1Points: integer('player1_points').notNull(),
    player2Points: integer('player2_points').notNull(),
    player1Break: integer('player1_break'),
    player2Break: integer('player2_break'),
    createdAt,
  },
  (table) => [
    index('match_frames_match_id_idx').on(table.matchId),
    uniqueIndex('match_frames_match_frame_uq').on(
      table.matchId,
      table.frameNumber,
    ),
    nonNegativeCheck('match_frames_frame_number_nonneg', table.frameNumber),
    nonNegativeCheck('match_frames_p1_points_nonneg', table.player1Points),
    nonNegativeCheck('match_frames_p2_points_nonneg', table.player2Points),
    nonNegativeCheck('match_frames_p1_break_nonneg', table.player1Break),
    nonNegativeCheck('match_frames_p2_break_nonneg', table.player2Break),
  ],
);
