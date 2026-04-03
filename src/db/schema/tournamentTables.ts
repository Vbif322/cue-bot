import { integer, primaryKey, uuid } from 'drizzle-orm/pg-core';
import { prodSchema } from '../schemaHelpers.js';
import { tournaments } from './tournaments.js';
import { tables } from './tables.js';

export const tournamentTables = prodSchema.table(
  'tournament_tables',
  {
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    tableId: uuid('table_id')
      .notNull()
      .references(() => tables.id, { onDelete: 'cascade' }),
    position: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tournamentId, t.tableId] })],
);
