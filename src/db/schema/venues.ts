import { index, text, uuid, varchar } from 'drizzle-orm/pg-core';
import type { UUID } from 'crypto';

import { createdAt, prodSchema } from '../schemaHelpers.js';
import { federations } from './federations.js';

export const venues = prodSchema.table(
  'venues',
  {
    id: uuid('id').$type<UUID>().primaryKey().defaultRandom(),
    name: varchar({ length: 255 }).notNull(),
    address: text('address').notNull(),
    // Город площадки — единственный источник «города турнира» (у турнира
    // всегда есть площадка). NULL только у площадок, созданных до M8; API
    // требует город при создании. Нормализация — normalizeCity.
    city: varchar({ length: 100 }),
    // Владелец площадки. NULL = общая (платформенная) площадка: видна всем
    // организаторам, редактируют её только глобальные админы.
    federationId: uuid('federation_id')
      .$type<UUID>()
      .references(() => federations.id),
    image: text('image'),
    createdAt,
  },
  (table) => [index('venues_federation_idx').on(table.federationId)],
);
