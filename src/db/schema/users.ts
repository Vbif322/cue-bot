import {
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { UUID } from 'crypto';

import { enumCheck, prodSchema } from '../schemaHelpers.js';
import { federations } from './federations.js';

export const userRoles = ['user', 'admin'] as const;

export type IUserRole = (typeof userRoles)[number];

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
    role: varchar({ enum: userRoles }).notNull().default('user'),
    // Город игрока — дефолт фильтра ленты турниров. Нормализация — normalizeCity.
    city: varchar({ length: 100 }),
    // Для гостевых аккаунтов (telegram_id IS NULL), созданных организатором из
    // админки: какая федерация их завела. Нужна, чтобы гость попадал в ростер
    // федерации, а организатор мог править его имя. Null у всех остальных.
    // Ленивая ссылка с явным типом: users ↔ federations импортируют друг друга.
    createdByFederationId: uuid('created_by_federation_id')
      .$type<UUID>()
      .references((): AnyPgColumn => federations.id, { onDelete: 'set null' }),
    // Право организатора (платная опция): до этого момента пользователь может
    // создавать свои организации, а организации, где он owner, — новые турниры.
    // Выдаёт и продлевает платформенный админ. Null — права нет.
    organizerUntil: timestamp('organizer_until'),
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
    enumCheck('users_role_check', table.role, userRoles),
  ],
);
