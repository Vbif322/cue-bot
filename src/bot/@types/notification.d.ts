import type { notifications } from '../../db/schema.js';

import type { Serialize } from './helpers.ts';

export type NotificationType = (typeof notifications.$inferSelect)['type'];
export type Notification = typeof notifications.$inferSelect;

/** Serialized notification row for JSON responses (timestamps → string), without isSent/sentAt */
export type ApiNotification = Omit<
  Serialize<Notification>,
  'isSent' | 'sentAt'
>;
