import { Hono } from 'hono';
import { z } from 'zod';
import type { UUID } from 'crypto';

import {
  getFederation,
  listPublicFederations,
} from '@/services/federationService.js';

import { validateParam, validateQuery } from './_shared.js';

const listQuery = z.object({
  city: z.string().trim().min(1).max(100).optional(),
});
const paramId = z.object({ id: z.uuid() });

/**
 * Организаторы (федерации) для сайта игрока: публичный список для фильтра
 * ленты. Создание — только в боте/панели при платном праве организатора.
 */
export function createAppFederationsRouter() {
  const router = new Hono();

  router.get('/', validateQuery(listQuery), async (c) => {
    const { city } = c.req.valid('query');
    return c.json({
      data: await listPublicFederations(city !== undefined ? { city } : {}),
    });
  });

  router.get('/:id', validateParam(paramId), async (c) => {
    const { id } = c.req.valid('param');
    const federation = await getFederation(id as UUID);
    if (!federation) return c.json({ error: 'Организация не найдена' }, 404);
    return c.json({
      data: {
        id: federation.id,
        name: federation.name,
        city: federation.city,
        description: federation.description,
      },
    });
  });

  return router;
}
