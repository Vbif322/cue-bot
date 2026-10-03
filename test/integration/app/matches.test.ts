import type { UUID } from 'crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { eq } from 'drizzle-orm';

import { createAdminServer } from '@/admin/server/index.js';
import { bot } from '@/bot/instance.js';
import { db } from '@/db/db.js';
import { matches, tables } from '@/db/schema.js';
import { getMatch } from '@/services/matchService.js';
import { getTournament } from '@/services/tournamentService.js';

import { apiRequest, appCookie } from '../../helpers/auth.js';
import {
  createTournamentWithParticipants,
  createMatchesForTournament,
  createUser,
} from '../../helpers/factories.js';
import { truncateAll } from '../../helpers/truncate.js';
import { must } from '../../helpers/must.js';

let app: ReturnType<typeof createAdminServer>;

/** Стартованный турнир 2 игроков с одним матчем и id обоих участников. */
async function freshMatch() {
  const { tournament, participantIds } = await createTournamentWithParticipants(
    2,
    'single_elimination',
  );
  const matches = await createMatchesForTournament(
    tournament.id,
    'single_elimination',
  );
  const match = must(matches[0], 'match');
  return {
    matchId: match.id,
    p1: must(match.player1Id, 'p1'),
    p2: must(match.player2Id, 'p2'),
    tournamentId: tournament.id,
    participantIds,
  };
}

describe('app matches router', () => {
  beforeAll(() => {
    vi.spyOn(bot.api, 'sendMessage').mockResolvedValue(
      {} as Awaited<ReturnType<typeof bot.api.sendMessage>>,
    );
  });

  beforeEach(async () => {
    app = createAdminServer();
    await truncateAll();
  });

  it('report чужого матча → 403', async () => {
    const { matchId } = await freshMatch();
    const stranger = await createUser();

    const { status } = await apiRequest(
      app,
      'POST',
      `/api/app/matches/${matchId}/report`,
      { cookie: appCookie(stranger.id), body: { player1Score: 3, player2Score: 0 } },
    );
    expect(status).toBe(403);
  });

  it('confirm чужого матча → 403', async () => {
    const { matchId, p1 } = await freshMatch();
    await apiRequest(app, 'POST', `/api/app/matches/${matchId}/report`, {
      cookie: appCookie(p1),
      body: { player1Score: 3, player2Score: 0 },
    });
    const stranger = await createUser();

    const { status } = await apiRequest(
      app,
      'POST',
      `/api/app/matches/${matchId}/confirm`,
      { cookie: appCookie(stranger.id) },
    );
    expect(status).toBe(403);
  });

  it('нельзя подтвердить собственный отчёт (S2-10) → 400', async () => {
    const { matchId, p1 } = await freshMatch();
    await apiRequest(app, 'POST', `/api/app/matches/${matchId}/report`, {
      cookie: appCookie(p1),
      body: { player1Score: 3, player2Score: 0 },
    });

    const { status, body } = await apiRequest<{ error: string }>(
      app,
      'POST',
      `/api/app/matches/${matchId}/confirm`,
      { cookie: appCookie(p1) },
    );
    expect(status).toBe(400);
    expect(body.error).toBe('Нельзя подтверждать собственный отчёт');
  });

  describe('POST /:id/ready («Я у стола»)', () => {
    /** Вызвать матч к столу, как это делает assignTableAndCall. */
    async function callToTable(matchId: UUID, tournamentId: UUID) {
      const tournament = must(await getTournament(tournamentId), 'tournament');
      const [table] = await db
        .insert(tables)
        .values({ name: 'Стол 1', venueId: tournament.venueId })
        .returning();
      const now = new Date();
      await db
        .update(matches)
        .set({
          tableId: must(table, 'table').id,
          calledAt: now,
          callDeadlineAt: new Date(now.getTime() + 10 * 60_000),
        })
        .where(eq(matches.id, matchId));
    }

    it('оба игрока у стола → матч начинается', async () => {
      const { matchId, p1, p2, tournamentId } = await freshMatch();
      await callToTable(matchId, tournamentId);

      const first = await apiRequest<{ data: { started: boolean } }>(
        app,
        'POST',
        `/api/app/matches/${matchId}/ready`,
        { cookie: appCookie(p1) },
      );
      expect(first.status).toBe(200);
      expect(first.body.data.started).toBe(false);

      const second = await apiRequest<{ data: { started: boolean } }>(
        app,
        'POST',
        `/api/app/matches/${matchId}/ready`,
        { cookie: appCookie(p2) },
      );
      expect(second.status).toBe(200);
      expect(second.body.data.started).toBe(true);
      expect((await getMatch(matchId))?.status).toBe('in_progress');
    });

    it('матч не вызван к столу → 400', async () => {
      const { matchId, p1 } = await freshMatch();

      const { status, body } = await apiRequest<{ error: string }>(
        app,
        'POST',
        `/api/app/matches/${matchId}/ready`,
        { cookie: appCookie(p1) },
      );
      expect(status).toBe(400);
      expect(body.error).toBe('Матч не ожидает явки игроков');
    });

    it('чужой матч → 403', async () => {
      const { matchId, tournamentId } = await freshMatch();
      await callToTable(matchId, tournamentId);
      const stranger = await createUser();

      const { status } = await apiRequest(
        app,
        'POST',
        `/api/app/matches/${matchId}/ready`,
        { cookie: appCookie(stranger.id) },
      );
      expect(status).toBe(403);
    });
  });

  it('соперник подтверждает отчёт → 200', async () => {
    const { matchId, p1, p2 } = await freshMatch();
    await apiRequest(app, 'POST', `/api/app/matches/${matchId}/report`, {
      cookie: appCookie(p1),
      body: { player1Score: 3, player2Score: 0 },
    });

    const { status } = await apiRequest(
      app,
      'POST',
      `/api/app/matches/${matchId}/confirm`,
      { cookie: appCookie(p2) },
    );
    expect(status).toBe(200);
  });

  describe('GET /:id (доступ)', () => {
    it('игрок матча видит матч → 200', async () => {
      const { matchId, p1 } = await freshMatch();
      const { status, body } = await apiRequest<{ data: { id: UUID } }>(
        app,
        'GET',
        `/api/app/matches/${matchId}`,
        { cookie: appCookie(p1) },
      );
      expect(status).toBe(200);
      expect(body.data.id).toBe(matchId);
    });

    it('невалидный UUID → 400', async () => {
      const player = await createUser();
      const { status } = await apiRequest(
        app,
        'GET',
        '/api/app/matches/not-a-uuid',
        { cookie: appCookie(player.id) },
      );
      expect(status).toBe(400);
    });
  });
});
