import { index, integer, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import type { UUID } from 'crypto';

import { createdAt, prodSchema } from '../schemaHelpers.js';

/**
 * Одноразовые 6-значные коды входа на почту (беспарольный вход, Этап 3).
 * В БД хранится только `sha256(hex)` кода — plaintext уходит лишь в письмо.
 * Без FK на `users`: юзера может ещё не быть — он создаётся при первом успешном
 * входе. Погашение атомарно (`used_at`); попытки лимитируются (`attempts` ≤ 5),
 * коды живут 10 минут (`expires_at`). Просроченные подчищает часовой sweep.
 */
export const emailLoginCodes = prodSchema.table(
  'email_login_codes',
  {
    id: uuid('id').$type<UUID>().primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull(), // нормализованный (trim+lowercase)
    codeHash: varchar('code_hash', { length: 64 }).notNull(), // sha256(hex)
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at').notNull(),
    usedAt: timestamp('used_at'), // NULL = код ещё жив
    createdAt,
  },
  (table) => [
    // Поиск живого кода адреса и гашение прежних кодов при новом запросе.
    index('email_login_codes_email_idx').on(table.email),
  ],
);

export type IEmailLoginCode = typeof emailLoginCodes.$inferSelect;
