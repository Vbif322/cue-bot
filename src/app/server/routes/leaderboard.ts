import { Hono } from 'hono';

import {
  getMaxBreakLeaderboard,
  toApiMaxBreakEntry,
} from '@/services/leaderboardService.js';

/** Публичные таблицы лидеров (доступны гостю, без requireUser). */
export function createAppLeaderboardRouter() {
  const router = new Hono();

  router.get('/breaks', async (c) => {
    const entries = await getMaxBreakLeaderboard();
    return c.json({
      data: entries.map((e) =>
        toApiMaxBreakEntry(e, { hidePrivateTournaments: true }),
      ),
    });
  });

  return router;
}
