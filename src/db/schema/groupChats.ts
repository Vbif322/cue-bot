import { boolean, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import type { UUID } from 'crypto';

import {
  createdAt,
  enumCheck,
  prodSchema,
  updatedAt,
} from '../schemaHelpers.js';
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
 * ИНВАРИАНТ НА СЕГОДНЯ: платформа = одна неявная федерация, поэтому все
 * публичные турниры уходят во все активные чаты. Когда появятся привязка чата
 * к турниру и федерации (M7/M8), меняется ТОЛЬКО тело того шва — здесь
 * добавится колонка/junction, а не переосмысление существующих.
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
    // Ops-хлебные крошки: `my_chat_member:kicked`, `403: bot was kicked`, …
    deactivatedAt: timestamp('deactivated_at'),
    deactivatedReason: varchar('deactivated_reason', { length: 255 }),
    createdAt,
    updatedAt,
  },
  (table) => [enumCheck('group_chats_type_check', table.type, groupChatTypes)],
);

export type IGroupChat = typeof groupChats.$inferSelect;
