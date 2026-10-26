import { index, text, uuid, varchar } from 'drizzle-orm/pg-core';
import type { UUID } from 'crypto';

import { createdAt, prodSchema, updatedAt } from '../schemaHelpers.js';
import { users } from './users.js';

/**
 * Федерация = организатор (ROADMAP M8). Любая организация, проводящая турниры —
 * федерация, клуб, частный организатор — одна строка здесь. Игроки в федерации
 * НЕ вступают: они находят турниры через ленту с фильтрами по городу и по
 * организатору. Команда федерации (владельцы/организаторы) — в `federation_members`.
 *
 * Турниры/площадки/чаты с `federationId IS NULL` — «платформенные»: ими
 * распоряжаются только пользователи с глобальной ролью `admin` (супер-админ
 * платформы). Так старые данные не требуют backfill'а, а скоуп организатора
 * (`inArray(federationId, ids)`) никогда не захватывает NULL.
 *
 * `city` — город по умолчанию для площадок и фильтров ленты. Нормализация —
 * `normalizeCity` (`src/shared/city.ts`), сравнение в SQL — без учёта регистра.
 */
export const federations = prodSchema.table(
  'federations',
  {
    id: uuid('id').$type<UUID>().primaryKey().defaultRandom(),
    name: varchar({ length: 255 }).notNull(),
    city: varchar({ length: 100 }).notNull(),
    description: text(),
    createdBy: uuid('created_by')
      .$type<UUID>()
      .notNull()
      .references(() => users.id),
    createdAt,
    updatedAt,
  },
  (table) => [index('federations_city_idx').on(table.city)],
);

export type IFederation = typeof federations.$inferSelect;
