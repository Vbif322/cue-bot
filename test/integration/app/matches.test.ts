import type { UUID } from 'crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAdminServer } from '@/admin/server/index.js';
import { bot } from '@/bot/instance.js';

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
