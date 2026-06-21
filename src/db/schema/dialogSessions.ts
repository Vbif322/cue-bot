import { jsonb, primaryKey, timestamp, varchar } from 'drizzle-orm/pg-core';

import { createdAt, prodSchema, updatedAt } from '../schemaHelpers.js';

/**
 * Персистентное диалоговое/wizard-состояние бота.
 *
 * Заменяет module-level in-memory `Map`'ы — состояние переживает рестарт процесса.
 * `namespace` разделяет независимые хранилища ('tc' | 'profile-edit' | 'invite' |
 * 'match-schedule'); `key` — обычно telegram userId как строка.
 *
 * TTL: `expiresAt` обновляется при каждой записи. Чтения фильтруют просроченное,
 * периодический sweep удаляет его из таблицы.
 */
export const dialogSessions = prodSchema.table(
  'dialog_sessions',
  {
    namespace: varchar({ length: 32 }).notNull(),
    key: varchar({ length: 64 }).notNull(),
    data: jsonb('data').$type<unknown>().notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt,
    updatedAt,
  },
  (t) => [primaryKey({ columns: [t.namespace, t.key] })],
);

export type DialogSession = typeof dialogSessions.$inferSelect;
