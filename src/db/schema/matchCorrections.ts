import { integer, text, uuid } from 'drizzle-orm/pg-core';
import type { UUID } from 'crypto';

import { createdAt, prodSchema } from '../schemaHelpers.js';
import { users } from './users.js';
import { tournaments } from './tournaments.js';
import { matches } from './matches.js';

export const matchCorrections = prodSchema.table('match_corrections', {
  id: uuid('id').$type<UUID>().primaryKey().defaultRandom(),
  matchId: uuid('match_id')
    .$type<UUID>()
    .notNull()
    .references(() => matches.id, { onDelete: 'cascade' }),
  tournamentId: uuid('tournament_id')
    .$type<UUID>()
    .notNull()
    .references(() => tournaments.id, { onDelete: 'cascade' }),
  correctedBy: uuid('corrected_by')
    .$type<UUID>()
    .notNull()
    .references(() => users.id),
  reason: text().notNull(),
  previousPlayer1Score: integer('previous_player1_score'),
  previousPlayer2Score: integer('previous_player2_score'),
  previousWinnerId: uuid('previous_winner_id')
    .$type<UUID>()
    .references(() => users.id),
  newPlayer1Score: integer('new_player1_score'),
  newPlayer2Score: integer('new_player2_score'),
  newWinnerId: uuid('new_winner_id')
    .$type<UUID>()
    .references(() => users.id),
  // Downstream matches reset as a side effect of this correction.
  affectedMatchIds: uuid('affected_match_ids').$type<UUID>().array(),
  createdAt,
});
