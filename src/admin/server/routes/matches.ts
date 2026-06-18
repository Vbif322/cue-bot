import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Api } from 'grammy';
import type { UUID } from 'crypto';

import {
  getMatch,
  getTournamentMatches,
  getMatchStats,
  startMatch,
  reportResult,
  confirmResult,
  disputeResult,
  setTechnicalResult,
  setMatchTable,
  setMatchSchedule,
  previewCorrection,
  correctMatchResult,
  resyncAdvancement,
} from '@/services/matchService.js';
import { getTournament } from '@/services/tournamentService.js';
import {
  notifyMatchScheduled,
  notifyMatchStart,
  notifyResultPending,
} from '@/services/notificationService.js';

import { requireAdmin } from '../middleware.js';

export function createMatchesRouter(botApi: Api) {
  const router = new Hono();

  router.use('/*', requireAdmin);

  // List all matches for a tournament
  router.get('/tournament/:tournamentId', async (c) => {
    const matches = await getTournamentMatches(
      c.req.param('tournamentId') as UUID,
    );
    return c.json({ data: matches });
  });

  // Get match stats for a tournament
  router.get('/tournament/:tournamentId/stats', async (c) => {
    const stats = await getMatchStats(c.req.param('tournamentId') as UUID);
    return c.json({ data: stats });
  });

  // Get single match with player info
  router.get('/:id', async (c) => {
    const match = await getMatch(c.req.param('id') as UUID);
    if (!match) return c.json({ error: 'Матч не найден' }, 404);
    return c.json({ data: match });
  });

  // Start a match
  router.post('/:id/start', async (c) => {
    const id = c.req.param('id') as UUID;
    const result = await startMatch(id);
    if (!result.success) return c.json({ error: result.error }, 400);

    try {
      const matchWithPlayers = await getMatch(id);
      const tournament = matchWithPlayers
        ? await getTournament(matchWithPlayers.tournamentId)
        : null;
      if (matchWithPlayers && tournament) {
        await notifyMatchStart(botApi, matchWithPlayers, tournament.name, '');
      }
    } catch (err) {
      console.error(`Failed to notify match start for ${id}:`, err);
    }

    return c.json({ data: result.match });
  });

  // Report result (admin acts as one of the players)
  router.post(
    '/:id/report',
    zValidator(
      'json',
      z.object({
        reporterId: z.uuid(),
        player1Score: z.number().int().min(0),
        player2Score: z.number().int().min(0),
      }),
    ),
    async (c) => {
      const { reporterId, player1Score, player2Score } = c.req.valid('json');
      const matchId = c.req.param('id') as UUID;
      const result = await reportResult(
        matchId,
        reporterId as UUID,
        player1Score,
        player2Score,
      );
      if (!result.success) return c.json({ error: result.error }, 400);

      try {
        const updated = await getMatch(matchId);
        if (updated) {
          await notifyResultPending(botApi, updated, reporterId as UUID);
        }
      } catch (error) {
        console.error('Failed to send result pending notification:', error);
      }

      return c.json({ ok: true });
    },
  );

  // Confirm result
  router.post(
    '/:id/confirm',
    zValidator('json', z.object({ confirmerId: z.uuid() })),
    async (c) => {
      const { confirmerId } = c.req.valid('json');
      const result = await confirmResult(
        c.req.param('id') as UUID,
        confirmerId as UUID,
        botApi,
      );
      if (!result.success) return c.json({ error: result.error }, 400);
      return c.json({ ok: true });
    },
  );

  // Dispute result
  router.post(
    '/:id/dispute',
    zValidator('json', z.object({ userId: z.uuid() })),
    async (c) => {
      const { userId } = c.req.valid('json');
      const result = await disputeResult(
        c.req.param('id') as UUID,
        userId as UUID,
      );
      if (!result.success) return c.json({ error: result.error }, 400);
      return c.json({ ok: true });
    },
  );

  // Set technical result
  router.post(
    '/:id/technical',
    zValidator(
      'json',
      z.object({
        winnerId: z.uuid(),
        reason: z.string().min(1),
      }),
    ),
    async (c) => {
      const { winnerId, reason } = c.req.valid('json');
      const admin = c.get('adminUser');
      const result = await setTechnicalResult(
        c.req.param('id') as UUID,
        winnerId as UUID,
        reason,
        admin.id,
        botApi,
      );
      if (!result.success) return c.json({ error: result.error }, 400);
      return c.json({ ok: true });
    },
  );

  // Preview a result correction (dry run — no writes)
  router.post(
    '/:id/correct/preview',
    zValidator(
      'json',
      z.object({
        player1Score: z.number().int().min(0),
        player2Score: z.number().int().min(0),
      }),
    ),
    async (c) => {
      const { player1Score, player2Score } = c.req.valid('json');
      const preview = await previewCorrection(
        c.req.param('id') as UUID,
        player1Score,
        player2Score,
      );
      return c.json({ data: preview });
    },
  );

  // Correct the result of a completed match (rolls back downstream matches)
  router.post(
    '/:id/correct',
    zValidator(
      'json',
      z.object({
        player1Score: z.number().int().min(0),
        player2Score: z.number().int().min(0),
        reason: z.string().min(1),
      }),
    ),
    async (c) => {
      const { player1Score, player2Score, reason } = c.req.valid('json');
      const admin = c.get('adminUser');
      const result = await correctMatchResult(
        c.req.param('id') as UUID,
        player1Score,
        player2Score,
        reason,
        admin.id,
        botApi,
      );
      if (!result.success) return c.json({ error: result.error }, 400);
      return c.json({
        ok: true,
        affectedCount: result.affectedCount ?? 0,
        winnerChanged: result.winnerChanged ?? false,
        warning: result.warning,
      });
    },
  );

  // Recovery: re-run advancement for a completed match (idempotent)
  router.post('/:id/advance', async (c) => {
    const result = await resyncAdvancement(c.req.param('id') as UUID, botApi);
    if (!result.success) return c.json({ error: result.error }, 400);
    return c.json({ ok: true });
  });

  // Assign / change / remove table (admin override)
  router.put(
    '/:id/table',
    zValidator('json', z.object({ tableId: z.uuid().nullable() })),
    async (c) => {
      const { tableId } = c.req.valid('json');
      const result = await setMatchTable(
        c.req.param('id') as UUID,
        tableId as UUID | null,
      );
      if (!result.success) return c.json({ error: result.error }, 400);
      return c.json({ ok: true });
    },
  );

  // Assign / clear a match's scheduled date-time (per-match scheduling).
  // `scheduledAt` is an ISO-8601 UTC string, or null to clear.
  router.put(
    '/:id/schedule',
    zValidator(
      'json',
      z.object({ scheduledAt: z.iso.datetime().nullable() }),
    ),
    async (c) => {
      const id = c.req.param('id') as UUID;
      const { scheduledAt } = c.req.valid('json');
      const date = scheduledAt ? new Date(scheduledAt) : null;

      const result = await setMatchSchedule(id, date);
      if (!result.success) return c.json({ error: result.error }, 400);

      // Notify players when a concrete time is set (not on clear).
      if (date) {
        const match = await getMatch(id);
        if (match) {
          const tournament = await getTournament(match.tournamentId);
          if (tournament) {
            await notifyMatchScheduled(botApi, match, tournament.name, date);
          }
        }
      }

      return c.json({ ok: true });
    },
  );

  return router;
}
