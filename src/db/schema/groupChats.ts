import { boolean, index, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import type { UUID } from 'crypto';

import {
  createdAt,
  enumCheck,
  prodSchema,
  updatedAt,
} from '../schemaHelpers.js';
import { federations } from './federations.js';
import { users } from './users.js';

export const groupChatTypes = ['group', 'supergroup'] as const;

export type IGroupChatType = (typeof groupChatTypes)[number];

/**
 * Реестр групповых чатов, куда бот шлёт анонсы (ROADMAP M7, этап 1).
 *
 * Таблица НЕ знает ничего про турниры — это намеренно. «Какие чаты должны
 * услышать про этот турнир» решает единственный шов
 * `resolveAnnouncementTargets` (`src/services/groupChatService.ts`).
 *
 * ИНВАРИАНТ: бот пишет только в чаты, привязанные к федерации
 * (`federation_id`, M8), и шлёт туда лишь турниры этой федерации. Непривязанный
 * чат зарегистрирован (кандидат на привязку в панели), но бот в нём молчит.
 *
 * `chat_id` хранится строкой (как `users.telegram_id`): id супергрупп вида
 * `-100…` не помещается в int4, а Telegram принимает строковый chat_id везде.
 * Бота выгнали — строку НЕ удаляем, а гасим `is_active`: так переживают
 * повторное добавление `added_by` и история.
 */
export const groupChats = prodSchema.table(
  'group_chats',
  {
    chatId: varchar('chat_id', { length: 32 }).primaryKey(),
    type: varchar({ enum: groupChatTypes }).$type<IGroupChatType>().notNull(),
    title: varchar({ length: 255 }),
    // Кто добавил бота. Подписка не должна умирать вместе с пользователем,
    // отсюда set null. Заодно — мостик для будущего бэкфилла привязки чата.
    addedBy: uuid('added_by')
      .$type<UUID>()
      .references(() => users.id, { onDelete: 'set null' }),
    // ТОЧКА РЕШЕНИЯ M7: default true = автоподписка при добавлении бота.
    // Переключение на модель «явный bind командой» — это смена дефолта здесь
    // и текста приветствия, больше ничего.
    isActive: boolean('is_active').notNull().default(true),
    // Привязка к федерации (M8). NULL = бот в чате молчит (ни анонсов, ни
    // ответов на команды); привязанный слышит только турниры своей федерации.
    // Удаление федерации отвязывает чат, не убивает.
    federationId: uuid('federation_id')
      .$type<UUID>()
      .references(() => federations.id, { onDelete: 'set null' }),
    // Ops-хлебные крошки: `my_chat_member:kicked`, `403: bot was kicked`, …
    deactivatedAt: timestamp('deactivated_at'),
    deactivatedReason: varchar('deactivated_reason', { length: 255 }),
    createdAt,
    updatedAt,
  },
  (table) => [
    index('group_chats_federation_idx').on(table.federationId),
    enumCheck('group_chats_type_check', table.type, groupChatTypes),
  ],
);

export type IGroupChat = typeof groupChats.$inferSelect;
