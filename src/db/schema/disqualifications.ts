import { text, uuid } from 'drizzle-orm/pg-core';
import type { UUID } from 'crypto';

import { createdAt, prodSchema } from '../schemaHelpers.js';
import { users } from './users.js';
import { tournaments } from './tournaments.js';

export const disqualifications = prodSchema.table('disqualifications', {
  id: uuid('id').$type<UUID>().primaryKey().defaultRandom(),
  tournamentId: uuid('tournament_id')
    .$type<UUID>()
    .notNull()
    .references(() => tournaments.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .$type<UUID>()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  reason: text().notNull(),
  disqualifiedBy: uuid('disqualified_by')
    .$type<UUID>()
    .notNull()
    .references(() => users.id),
  createdAt,
});
