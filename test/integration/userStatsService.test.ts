import type { UUID } from 'crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import type { Match } from '@/bot/@types/match.js';
import {
  confirmResult,
  reportResultFromFrames,
  saveMatchFrame,
  setTechnicalResult,
  startMatch,
} from '@/services/matchService.js';
import { getUserMatchStats } from '@/services/userStatsService.js';

import {
  completeMatch,
  createAdminUser,
  createMatchesForTournament,
  createTournamentWithParticipants,
  createUser,
} from '../helpers/factories.js';
import { must } from '../helpers/must.js';
import { truncateAll } from '../helpers/truncate.js';

/** A fresh single-match 2-player single-elimination tournament (winScore 3). */
async function freshMatch(): Promise<{ match: Match; p1: UUID; p2: UUID }> {
  const { tournament, participantIds } = await createTournamentWithParticipants(
    2,
    'single_elimination',
  );
  const all = await createMatchesForTournament(
    tournament.id,
    'single_elimination',
  );
  return {
    match: must(all[0], 'match'),
    p1: must(participantIds[0], 'seed1'),
    p2: must(participantIds[1], 'seed2'),
  };
}

describe('getUserMatchStats', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns zeros and nulls for a user without matches', async () => {
    const user = await createUser();
    expect(await getUserMatchStats(user.id)).toEqual({
      played: 0,
      wins: 0,
      losses: 0,
      framesWon: 0,
      framesLost: 0,
      points: null,
      maxBreak: null,
    });
  });

  it('counts frames from an aggregate score, without points or breaks', async () => {
    const { match, p1, p2 } = await freshMatch();
    await completeMatch(match.id, p2); // 0–3 for player1

    expect(await getUserMatchStats(p1)).toMatchObject({
      played: 1,
      wins: 0,
      losses: 1,
      framesWon: 0,
      framesLost: 3,
      points: null,
      maxBreak: null,
    });
    expect(await getUserMatchStats(p2)).toMatchObject({
      wins: 1,
      framesWon: 3,
      framesLost: 0,
    });
  });

  it('sums points and takes the max break from each player’s own slot', async () => {
    const { match, p1, p2 } = await freshMatch();
    await startMatch(match.id);
    const reported = await reportResultFromFrames(match.id, p1, [
      { player1Points: 74, player2Points: 12, player1Break: 50 },
      { player1Points: 8, player2Points: 66, player2Break: 45 },
      { player1Points: 90, player2Points: 5, player1Break: 62 },
      { player1Points: 55, player2Points: 40, player2Break: 30 },
    ]);
    expect(reported.success).toBe(true);

    // Pending confirmation is not counted yet.
    expect((await getUserMatchStats(p1)).points).toBeNull();

    await confirmResult(match.id, p2);

    expect(await getUserMatchStats(p1)).toMatchObject({
      framesWon: 3,
      framesLost: 1,
      points: { won: 227, lost: 123 },
      maxBreak: 62,
    });
    expect(await getUserMatchStats(p2)).toMatchObject({
      framesWon: 1,
      framesLost: 3,
      points: { won: 123, lost: 227 },
      maxBreak: 45,
    });
  });

  it('ignores draft frames of a match still in play', async () => {
    const { match, p1 } = await freshMatch();
    await startMatch(match.id);
    await saveMatchFrame(match.id, 1, {
      player1Points: 100,
      player2Points: 0,
      player1Break: 100,
    });

    expect(await getUserMatchStats(p1)).toMatchObject({
      played: 0,
      framesWon: 0,
      points: null,
      maxBreak: null,
    });
  });

  it('counts a technical result as a match, but not its frames', async () => {
    const admin = await createAdminUser();
    const { match, p1, p2 } = await freshMatch();
    const res = await setTechnicalResult(match.id, p1, 'неявка', admin.id);
    expect(res.success).toBe(true);

    expect(await getUserMatchStats(p1)).toMatchObject({
      played: 1,
      wins: 1,
      framesWon: 0,
      framesLost: 0,
      points: null,
    });
    expect(await getUserMatchStats(p2)).toMatchObject({
      played: 1,
      losses: 1,
      framesWon: 0,
      framesLost: 0,
    });
  });
});
