import { Hono } from 'hono';
import { z } from 'zod';
import type { UUID } from 'crypto';

import {
  getNotifications,
  markAsRead,
  markAllAsRead,
} from '@/services/notificationService.js';
import { requireUser } from '@/admin/server/middleware.js';

import { validateParam, validateQuery } from './_shared.js';

const paramId = z.object({ id: z.uuid() });
const listQuery = z.object({
  unread: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export function createAppNotificationsRouter() {
  const router = new Hono();

  router.use('/*', requireUser);

  router.get('/', validateQuery(listQuery), async (c) => {
    const { unread, limit } = c.req.valid('query');
    const unreadOnly = unread === '1' || unread === 'true';
    const list = await getNotifications(c.get('appUser').id, {
      unreadOnly,
      ...(limit !== undefined ? { limit } : {}),
    });
    return c.json({ data: list });
  });

  router.post('/read-all', async (c) => {
    await markAllAsRead(c.get('appUser').id);
    return c.json({ data: { ok: true } });
  });

  router.post('/:id/read', validateParam(paramId), async (c) => {
    const { id } = c.req.valid('param') as { id: UUID };
    const updated = await markAsRead(id, c.get('appUser').id);
    if (!updated) return c.json({ error: 'Уведомление не найдено' }, 404);
    return c.json({ data: { ok: true } });
  });

  return router;
}
