import { integer, primaryKey, uuid } from 'drizzle-orm/pg-core';
import type { UUID } from 'crypto';

import { prodSchema } from '../schemaHelpers.js';
import { tournaments } from './tournaments.js';
import { tables } from './tables.js';

export const tournamentTables = prodSchema.table(
  'tournament_tables',
  {
    tournamentId: uuid('tournament_id')
      .$type<UUID>()
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    tableId: uuid('table_id')
      .$type<UUID>()
      .notNull()
      .references(() => tables.id, { onDelete: 'cascade' }),
    position: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tournamentId, t.tableId] })],
);
