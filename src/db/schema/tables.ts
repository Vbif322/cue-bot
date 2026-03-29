import { uuid, varchar } from 'drizzle-orm/pg-core';
import type { UUID } from 'crypto';

import { createdAt, prodSchema } from '../schemaHelpers.js';
import { venues } from './venues.js';

export const tables = prodSchema.table('tables', {
  id: uuid('id').$type<UUID>().primaryKey().defaultRandom(),
  name: varchar({ length: 100 }).notNull(),
  venueId: uuid('venue_id')
    .$type<UUID>()
    .notNull()
    .references(() => venues.id, { onDelete: 'cascade' }),
  createdAt,
});
