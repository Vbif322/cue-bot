import { Hono } from 'hono';

import {
  getMaxBreakLeaderboard,
  toApiMaxBreakEntry,
} from '@/services/leaderboardService.js';
import { requireStaff } from '../middleware.js';
import { federationFilterFromQuery } from './_shared.js';

export function createLeaderboardRouter() {
  const router = new Hono();

  router.use('/*', requireStaff);

  // Each player's best break of 20+, private tournaments included. Platform admin:
  // global (or one federation via ?federationId=); organizer: their federations.
  router.get('/breaks', async (c) => {
    const filter = federationFilterFromQuery(c);
    if (filter.error) return filter.error;
    const admin = c.get('adminUser');
    const federationIds =
      filter.federationId !== undefined
        ? filter.federationId === null
          ? undefined
          : [filter.federationId]
        : admin.isPlatformAdmin
          ? undefined
          : admin.federationIds;
    const entries = await getMaxBreakLeaderboard(
      federationIds ? { federationIds } : {},
    );
    return c.json({
      data: entries.map((e) =>
        toApiMaxBreakEntry(e, { hidePrivateTournaments: false }),
      ),
    });
  });

  return router;
}
