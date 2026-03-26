import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  getVenues,
  createVenue,
  updateVenue,
  deleteVenue,
} from '../../../services/venueService.js';
import { requireAdmin } from '../middleware.js';

const paramSchema = z.object({ id: z.string().uuid() });

export function createVenuesRouter() {
  const router = new Hono();

  router.use('/*', requireAdmin);

  router.get('/', async (c) => {
    const list = await getVenues();
    return c.json({ data: list });
  });

  router.post(
    '/',
    zValidator(
      'json',
      z.object({
        name: z.string().min(1).max(255),
        address: z.string().min(1).max(500),
        image: z.string().url().optional(),
      }),
    ),
    async (c) => {
      const data = c.req.valid('json');
      const venue = await createVenue(data);
      return c.json({ data: venue }, 201);
    },
  );

  router.patch(
    '/:id',
    zValidator('param', paramSchema),
    zValidator(
      'json',
      z
        .object({
          name: z.string().min(1).max(255).optional(),
          address: z.string().min(1).max(500).optional(),
          image: z.string().url().nullable().optional(),
        })
        .refine((d) => Object.keys(d).length > 0, {
          message: 'At least one field required',
        }),
    ),
    async (c) => {
      const { id } = c.req.valid('param');
      const data = c.req.valid('json');
      const venue = await updateVenue(id, data);
      if (!venue) return c.json({ error: 'Not found' }, 404);
      return c.json({ data: venue });
    },
  );

  router.delete('/:id', zValidator('param', paramSchema), async (c) => {
    const { id } = c.req.valid('param');
    const deleted = await deleteVenue(id);
    if (!deleted) return c.json({ error: 'Not found' }, 404);
    return c.json({ ok: true });
  });

  return router;
}
