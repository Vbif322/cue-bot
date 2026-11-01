import { index, primaryKey, uuid, varchar } from 'drizzle-orm/pg-core';
import type { UUID } from 'crypto';

import { createdAt, enumCheck, prodSchema } from '../schemaHelpers.js';
import { federations } from './federations.js';
import { users } from './users.js';

/**
 * Роли внутри федерации. `owner` управляет самой федерацией (состав, настройки),
 * `organizer` — только её турнирами. Судья — НЕ роль федерации: это строка
 * `tournament_referees` на конкретном турнире.
 */
export const federationRoles = ['owner', 'organizer'] as const;

export type IFederationRole = (typeof federationRoles)[number];

/**
 * Команда федерации. «Организатор» как глобальное понятие — производное:
 * пользователь состоит хотя бы в одной федерации. В `users.role` третьего
 * значения нет намеренно.
 *
 * Инвариант «у федерации всегда ≥1 owner» держит сервис
 * (`federationService.removeMember` / `setMemberRole`), не БД.
 */
export const federationMembers = prodSchema.table(
  'federation_members',
  {
    federationId: uuid('federation_id')
      .$type<UUID>()
      .notNull()
      .references(() => federations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .$type<UUID>()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar({ enum: federationRoles }).$type<IFederationRole>().notNull(),
    createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.federationId, table.userId] }),
    // Горячий путь авторизации: «в каких федерациях состоит пользователь».
    index('federation_members_user_idx').on(table.userId),
    enumCheck('federation_members_role_check', table.role, federationRoles),
  ],
);

export type IFederationMember = typeof federationMembers.$inferSelect;
