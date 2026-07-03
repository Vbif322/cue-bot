import { timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import type { UUID } from 'crypto';

import { createdAt, enumCheck, prodSchema, updatedAt } from '../schemaHelpers.js';
import { users } from './users.js';

export const identityProviders = ['telegram', 'email'] as const;

export type IIdentityProvider = (typeof identityProviders)[number];

/**
 * Реестр способов входа, отвязанный от Telegram (предусловие аудита S2-2).
 * Аддитивно к `users`: `users.telegram_id` остаётся каноничным идентификатором
 * бота, а identity-строки готовят почву под нативные email/пароль-аккаунты (Этап 3).
 * `provider_id` — telegram_id как строка (provider='telegram') или email в lowercase
 * (provider='email'). `password_hash`/`email_verified_at` заполняются только для email.
 */
export const userIdentities = prodSchema.table(
  'user_identities',
  {
    id: uuid('id').$type<UUID>().primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .$type<UUID>()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: varchar({ enum: identityProviders }).notNull(),
    providerId: varchar('provider_id', { length: 255 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }),
    emailVerifiedAt: timestamp('email_verified_at'),
    createdAt,
    updatedAt,
  },
  (table) => [
    // Один аккаунт провайдера — один юзер (арбитр для ON CONFLICT бэкфилла).
    uniqueIndex('user_identities_provider_provider_id_unique').on(
      table.provider,
      table.providerId,
    ),
    // В M1 не более одной identity каждого типа на юзера.
    uniqueIndex('user_identities_user_id_provider_unique').on(
      table.userId,
      table.provider,
    ),
    enumCheck('user_identities_provider_check', table.provider, identityProviders),
  ],
);

export type IUserIdentity = typeof userIdentities.$inferSelect;
