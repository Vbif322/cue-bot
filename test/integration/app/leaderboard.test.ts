import { beforeEach, describe, expect, it } from 'vitest';

import { createAdminServer } from '@/admin/server/index.js';
import type { ApiMaxBreakLeaderboardEntry } from '@/bot/@types/user.js';
import {
  confirmResult,
  reportResultFromFrames,
  startMatch,
} from '@/services/matchService.js';

import { apiRequest, appCookie } from '../../helpers/auth.js';
import {
  createAdminUser,
  createMatchesForTournament,
  createTournamentWithParticipants,
  createUser,
} from '../../helpers/factories.js';
import { must } from '../../helpers/must.js';
import { truncateAll } from '../../helpers/truncate.js';

const app = createAdminServer();

/** Completes a 3–0 match in a tournament of the given visibility; player1 breaks `value`. */
async function breakIn(
  visibility: 'public' | 'private',
  value: number,
): Promise<{ userId: string; tournamentName: string }> {
  const { tournament, participantIds } = await createTournamentWithParticipants(
    2,
    'single_elimination',
    { visibility },
  );
  const match = must(
    (await createMatchesForTournament(tournament.id, 'single_elimination'))[0],
    'match',
  );
  const p1 = must(participantIds[0], 'seed1');
  const p2 = must(participantIds[1], 'seed2');
  await startMatch(match.id);
  await reportResultFromFrames(match.id, p1, [
    { player1Points: 100, player2Points: 0, player1Break: value },
    { player1Points: 60, player2Points: 10 },
    { player1Points: 60, player2Points: 10 },
  ]);
  await confirmResult(match.id, p2);
  return { userId: p1, tournamentName: tournament.name };
}

interface Body {
  data: ApiMaxBreakLeaderboardEntry[];
}

describe('max-break leaderboard routes', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  describe('GET /api/app/leaderboard/breaks', () => {
    it('is public and hides private tournaments', async () => {
      const pub = await breakIn('public', 70);
      const priv = await breakIn('private', 40);

      const { status, body } = await apiRequest<Body>(
        app,
        'GET',
        '/api/app/leaderboard/breaks',
      );
      expect(status).toBe(200);
      expect(body.data).toMatchObject([
        {
          rank: 1,
          userId: pub.userId,
          maxBreak: 70,
          tournament: { name: pub.tournamentName },
        },
        { rank: 2, userId: priv.userId, maxBreak: 40, tournament: null },
      ]);
      expect(typeof body.data[0]?.achievedAt).toBe('string');
    });

    it('works for a logged-in player too', async () => {
      const user = await createUser();
      const { status } = await apiRequest(
        app,
        'GET',
        '/api/app/leaderboard/breaks',
        { cookie: appCookie(user.id) },
      );
      expect(status).toBe(200);
    });
  });

  describe('GET /api/leaderboard/breaks', () => {
    it('rejects a non-admin', async () => {
      const user = await createUser();
      const { status } = await apiRequest(
        app,
        'GET',
        '/api/leaderboard/breaks',
        { user },
      );
      expect(status).toBe(403);
    });

    it('shows private tournaments to an admin', async () => {
      const admin = await createAdminUser();
      const priv = await breakIn('private', 40);

      const { status, body } = await apiRequest<Body>(
        app,
        'GET',
        '/api/leaderboard/breaks',
        { user: admin },
      );
      expect(status).toBe(200);
      expect(body.data).toMatchObject([
        { userId: priv.userId, tournament: { name: priv.tournamentName } },
      ]);
    });
  });
});
