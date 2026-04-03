import { boolean, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import type { UUID } from 'crypto';

import { createdAt, prodSchema } from '../schemaHelpers.js';
import { users } from './users.js';
import { tournaments } from './tournaments.js';
import { matches } from './matches.js';

export const notificationTypes = [
  'registration_confirmed',
  'registration_rejected',
  'bracket_formed',
  'match_reminder',
  'result_confirmation_request',
  'result_confirmed',
  'tournament_results',
  'new_registration',
  'participant_limit_reached',
  'result_dispute',
  'match_result_pending',
  'disqualification',
] as const;

export type NotificationType = (typeof notificationTypes)[number];

export const notifications = prodSchema.table('notifications', {
  id: uuid('id').$type<UUID>().primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .$type<UUID>()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  type: varchar({ enum: notificationTypes }).notNull(),
  title: varchar({ length: 255 }).notNull(),
  message: text().notNull(),
  tournamentId: uuid('tournament_id')
    .$type<UUID>()
    .references(() => tournaments.id, {
      onDelete: 'set null',
    }),
  matchId: uuid('match_id')
    .$type<UUID>()
    .references(() => matches.id, {
      onDelete: 'set null',
    }),
  isRead: boolean('is_read').notNull().default(false),
  isSent: boolean('is_sent').notNull().default(false),
  sentAt: timestamp('sent_at'),
  createdAt,
});

export type INotification = typeof notifications.$inferSelect;
