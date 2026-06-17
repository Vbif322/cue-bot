import { timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { UUID } from 'crypto';

import { prodSchema } from '../schemaHelpers.js';

export const users = prodSchema.table(
  'users',
  {
    id: uuid('id').$type<UUID>().primaryKey().defaultRandom(),
    telegram_id: varchar({ length: 255 }).unique(),
    username: varchar({ length: 255 }).notNull(),
    phone: varchar({ length: 20 }),
    email: varchar({ length: 255 }),
    name: varchar({ length: 50 }),
    surname: varchar({ length: 100 }),
    role: varchar({ enum: ['user', 'admin'] })
      .notNull()
      .default('user'),
    // Soft-delete marker: null = active. When set, the row is a tombstone — personal
    // data is wiped and it is hidden from the admin list. History/FK references stay intact.
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [
    // username is the human-typed identifier for bot role commands (/set_admin @x);
    // enforce uniqueness only for real Telegram accounts so the lookup is deterministic.
    // Guest/external rows (telegram_id IS NULL) are exempt — they never authenticate.
    uniqueIndex('users_username_telegram_unique')
      .on(table.username)
      .where(sql`telegram_id is not null`),
  ],
);
