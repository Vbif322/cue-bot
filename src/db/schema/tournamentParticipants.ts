import {
  integer,
  primaryKey,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { UUID } from 'crypto';

import { createdAt, enumCheck, prodSchema } from '../schemaHelpers.js';
import { tournaments } from './tournaments.js';
import { users } from './users.js';

export const participantStatus = [
  'pending',
  'confirmed',
  'cancelled',
  'disqualified',
  'invited',
] as const;

export type ParticipantStatus = (typeof participantStatus)[number];

export const tournamentParticipants = prodSchema.table(
  'tournament_participants',
  {
    tournamentId: uuid('tournament_id')
      .$type<UUID>()
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .$type<UUID>()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: varchar({ enum: participantStatus }).notNull().default('pending'),
    seed: integer(),
    // Set when a referee postpones a called match because this player didn't
    // show up: the table queue skips the player's matches until they report
    // back («Я на месте») or a referee clears it. Null = present.
    absentSince: timestamp('absent_since'),
    createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.tournamentId, table.userId] }),
    enumCheck(
      'tournament_participants_status_check',
      table.status,
      participantStatus,
    ),
  ],
);
