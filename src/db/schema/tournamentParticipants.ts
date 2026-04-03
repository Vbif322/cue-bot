import { integer, primaryKey, uuid, varchar } from 'drizzle-orm/pg-core';
import type { UUID } from 'crypto';

import { createdAt, prodSchema } from '../schemaHelpers.js';
import { tournaments } from './tournaments.js';
import { users } from './users.js';

export const participantStatus = [
  'pending',
  'confirmed',
  'cancelled',
  'disqualified',
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
    createdAt,
  },
  (table) => [primaryKey({ columns: [table.tournamentId, table.userId] })],
);
