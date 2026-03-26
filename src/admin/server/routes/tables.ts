import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  getTables,
  createTable,
  deleteTable,
} from '../../../services/tableService.js';
import { requireAdmin } from '../middleware.js';

export function createTablesRouter() {
  const router = new Hono();

  router.use('/*', requireAdmin);

  router.get('/', async (c) => {
    const list = await getTables();
    return c.json({ data: list });
  });

  router.post(
    '/',
    zValidator(
      'json',
      z.object({
        name: z.string().min(1).max(100),
        venueId: z.string().uuid(),
      }),
    ),
    async (c) => {
      const { name, venueId } = c.req.valid('json');
      const table = await createTable(name, venueId);
      return c.json({ data: table }, 201);
    },
  );

  router.delete(
    '/:id',
    zValidator('param', z.object({ id: z.string().uuid() })),
    async (c) => {
      const { id } = c.req.valid('param');
      const deleted = await deleteTable(id);
      if (!deleted) return c.json({ error: 'Not found' }, 404);
      return c.json({ ok: true });
    },
  );

  return router;
}
