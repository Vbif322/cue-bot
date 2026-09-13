import {
  integer,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { UUID } from 'crypto';

import { createdAt, enumCheck, prodSchema } from '../schemaHelpers.js';
import { groupChats } from './groupChats.js';
import { tournaments } from './tournaments.js';

export const groupAnnouncementKinds = ['registration_open'] as const;

export type IGroupAnnouncementKind = (typeof groupAnnouncementKinds)[number];

/**
 * Лог анонсов, отправленных в групповые чаты (ROADMAP M7, этап 1).
 *
 * Зачем отдельная таблица, а не `notifications`: там `userId` NOT NULL со
 * ссылкой на `users`, под чат он не годится — об этом прямо сказано в M7.
 *
 * Строка пишется ПОСЛЕ успешной отправки, а не «застолбить → отправить».
 * Ретраев на этом этапе нет, поэтому застолблённая строка при сбое навсегда
 * заблокировала бы чат: молчаливая дыра хуже редкого дубля.
 *
 * Уникальный индекс — единственный настоящий инвариант против повторной
 * рассылки: проверки перехода статуса закрывают обычный случай, но при вебхуке
 * Telegram переповторяет апдейт, если ответ был медленным.
 *
 * `message_id` пока только пишется; он понадобится, когда анонс начнут
 * редактировать на месте (следующие этапы M7).
 *
 * Оба FK каскадные: строка — производные данные без самостоятельной ценности.
 * Каскад по `tournament_id` НЕСУЩИЙ — `deleteTournament` жёстко удаляет
 * черновики, без него был бы 23503.
 */
export const groupAnnouncements = prodSchema.table(
  'group_announcements',
  {
    id: uuid('id').$type<UUID>().primaryKey().defaultRandom(),
    chatId: varchar('chat_id', { length: 32 })
      .notNull()
      .references(() => groupChats.chatId, { onDelete: 'cascade' }),
    tournamentId: uuid('tournament_id')
      .$type<UUID>()
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    kind: varchar({ enum: groupAnnouncementKinds })
      .$type<IGroupAnnouncementKind>()
      .notNull(),
    messageId: integer('message_id'),
    sentAt: timestamp('sent_at').notNull().defaultNow(),
    createdAt,
  },
  (table) => [
    uniqueIndex('group_announcements_chat_tournament_kind_unique').on(
      table.chatId,
      table.tournamentId,
      table.kind,
    ),
    enumCheck(
      'group_announcements_kind_check',
      table.kind,
      groupAnnouncementKinds,
    ),
  ],
);

export type IGroupAnnouncement = typeof groupAnnouncements.$inferSelect;
