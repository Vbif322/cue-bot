import { Hono } from 'hono';

import {
  getMaxBreakLeaderboard,
  toApiMaxBreakEntry,
} from '@/services/leaderboardService.js';
import { requireAdmin } from '../middleware.js';

export function createLeaderboardRouter() {
  const router = new Hono();

  router.use('/*', requireAdmin);

  // Each player's best break of 20+, private tournaments included
  router.get('/breaks', async (c) => {
    const entries = await getMaxBreakLeaderboard();
    return c.json({
      data: entries.map((e) =>
        toApiMaxBreakEntry(e, { hidePrivateTournaments: false }),
      ),
    });
  });

  return router;
}
