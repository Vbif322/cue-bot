import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { UUID } from 'crypto';

import {
  getVenues,
  getVenue,
  createVenue,
  updateVenue,
  deleteVenue,
} from '@/services/venueService.js';
import { errorMessage } from '@/utils/errors.js';

import { requireStaff } from '../middleware.js';
import {
  validateParam,
  idParam,
  scopeOf,
  canEditVenue,
  resolveFederationForWrite,
} from './_shared.js';

/**
 * Площадки. Общие (`federationId IS NULL`) видят все организаторы, но правит их
 * только платформенный админ; свои площадки федерация создаёт и правит сама.
 */
export function createVenuesRouter() {
  const router = new Hono();

  router.use('/*', requireStaff);

  router.get('/', async (c) => {
    const list = await getVenues({ scope: scopeOf(c) });
    return c.json({ data: list });
  });

  router.post(
    '/',
    zValidator(
      'json',
      z.object({
        name: z.string().min(1).max(255),
        address: z.string().min(1).max(500),
        city: z.string().min(1).max(100),
        image: z.url().optional(),
        // null = общая площадка (только админ); организатор обязан указать свою.
        federationId: z.uuid().nullable().default(null),
      }),
    ),
    async (c) => {
      const data = c.req.valid('json');
      const federationId = resolveFederationForWrite(
        c.get('adminUser'),
        data.federationId as UUID | null,
      );
      if (federationId === undefined) {
        return c.json({ error: 'Укажите свою организацию' }, 403);
      }
      try {
        const venue = await createVenue({
          name: data.name,
          address: data.address,
          city: data.city,
          image: data.image,
          federationId,
        });
        return c.json({ data: venue }, 201);
      } catch (error) {
        return c.json({ error: errorMessage(error) }, 400);
      }
    },
  );

  router.patch(
    '/:id',
    validateParam(idParam),
    zValidator(
      'json',
      z
        .object({
          name: z.string().min(1).max(255).optional(),
          address: z.string().min(1).max(500).optional(),
          city: z.string().min(1).max(100).optional(),
          image: z.url().nullable().optional(),
        })
        .refine((d) => Object.keys(d).length > 0, {
          message: 'At least one field required',
        }),
    ),
    async (c) => {
      const { id } = c.req.valid('param');
      const existing = await getVenue(id);
      if (!existing) return c.json({ error: 'Not found' }, 404);
      if (!canEditVenue(c.get('adminUser'), existing)) {
        return c.json({ error: 'Недостаточно прав' }, 403);
      }
      try {
        const venue = await updateVenue(id, c.req.valid('json'));
        if (!venue) return c.json({ error: 'Not found' }, 404);
        return c.json({ data: venue });
      } catch (error) {
        return c.json({ error: errorMessage(error) }, 400);
      }
    },
  );

  router.delete('/:id', validateParam(idParam), async (c) => {
    const { id } = c.req.valid('param');
    const existing = await getVenue(id);
    if (!existing) return c.json({ error: 'Not found' }, 404);
    if (!canEditVenue(c.get('adminUser'), existing)) {
      return c.json({ error: 'Недостаточно прав' }, 403);
    }
    const deleted = await deleteVenue(id);
    if (!deleted) return c.json({ error: 'Not found' }, 404);
    return c.json({ ok: true });
  });

  return router;
}
