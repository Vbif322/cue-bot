import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { UUID } from 'crypto';

import {
  getTables,
  getTable,
  createTable,
  deleteTable,
} from '@/services/tableService.js';
import { getVenue } from '@/services/venueService.js';

import { requireStaff } from '../middleware.js';
import { validateParam, idParam, scopeOf, canEditVenue } from './_shared.js';

/** Столы наследуют права своей площадки (см. venues.ts). */
export function createTablesRouter() {
  const router = new Hono();

  router.use('/*', requireStaff);

  router.get('/', async (c) => {
    const list = await getTables({ scope: scopeOf(c) });
    return c.json({ data: list });
  });

  router.post(
    '/',
    zValidator(
      'json',
      z.object({
        name: z.string().min(1).max(100),
        venueId: z.uuid(),
      }),
    ),
    async (c) => {
      const { name, venueId } = c.req.valid('json');
      const venue = await getVenue(venueId as UUID);
      if (!venue) return c.json({ error: 'Площадка не найдена' }, 404);
      if (!canEditVenue(c.get('adminUser'), venue)) {
        return c.json({ error: 'Недостаточно прав' }, 403);
      }
      const table = await createTable(name, venueId as UUID);
      return c.json({ data: table }, 201);
    },
  );

  router.delete('/:id', validateParam(idParam), async (c) => {
    const { id } = c.req.valid('param');
    const table = await getTable(id);
    if (!table) return c.json({ error: 'Not found' }, 404);
    const venue = await getVenue(table.venueId);
    if (!venue || !canEditVenue(c.get('adminUser'), venue)) {
      return c.json({ error: 'Недостаточно прав' }, 403);
    }
    const deleted = await deleteTable(id);
    if (!deleted) return c.json({ error: 'Not found' }, 404);
    return c.json({ ok: true });
  });

  return router;
}
