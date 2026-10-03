import type { UUID } from 'crypto';
import { eq } from 'drizzle-orm';

import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/db.js';
import { matches, users } from '@/db/schema.js';
import {
  confirmResult,
  reportResultFromFrames,
  saveMatchFrame,
  startMatch,
} from '@/services/matchService.js';
import { getMaxBreakLeaderboard } from '@/services/leaderboardService.js';

import {
  createMatchesForTournament,
  createTournamentWithParticipants,
} from '../helpers/factories.js';
import { must } from '../helpers/must.js';
import { truncateAll } from '../helpers/truncate.js';

type Frames = Parameters<typeof reportResultFromFrames>[2];

/** A fresh single-match 2-player tournament (winScore 3), match started. */
async function startedMatch(): Promise<{ matchId: UUID; p1: UUID; p2: UUID }> {
  const { tournament, participantIds } = await createTournamentWithParticipants(
    2,
    'single_elimination',
  );
  const all = await createMatchesForTournament(
    tournament.id,
    'single_elimination',
  );
  const match = must(all[0], 'match');
  await startMatch(match.id);
  return {
    matchId: match.id,
    p1: must(participantIds[0], 'seed1'),
    p2: must(participantIds[1], 'seed2'),
  };
}

/** Plays a match to completion with the given frames (player1 must win 3). */
async function playMatch(
  frames: Frames,
): Promise<{ matchId: UUID; p1: UUID; p2: UUID }> {
  const m = await startedMatch();
  const reported = await reportResultFromFrames(m.matchId, m.p1, frames);
  expect(reported.success).toBe(true);
  const confirmed = await confirmResult(m.matchId, m.p2);
  expect(confirmed.success).toBe(true);
  return m;
}

/** player1 wins 3–0; breaks are [player1, player2] of the first frame. */
function sweep(player1Break: number, player2Break?: number): Frames {
  return [
    {
      player1Points: 90,
      player2Points: 30,
      player1Break,
      ...(player2Break != null ? { player2Break } : {}),
    },
    { player1Points: 60, player2Points: 10 },
    { player1Points: 60, player2Points: 10 },
  ];
}

describe('getMaxBreakLeaderboard', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('is empty when nobody has a break of 20+', async () => {
    await playMatch(sweep(19, 5));
    expect(await getMaxBreakLeaderboard()).toEqual([]);
  });

  it('includes a break of exactly 20 and drops 19', async () => {
    const { p1, p2 } = await playMatch(sweep(19, 20));
    const board = await getMaxBreakLeaderboard();
    expect(board.map((e) => [e.userId, e.maxBreak])).toEqual([[p2, 20]]);
    expect(board.some((e) => e.userId === p1)).toBe(false);
  });

  it('keeps one row per player with the best break from their own slot', async () => {
    const { p1, p2 } = await playMatch([
      { player1Points: 74, player2Points: 12, player1Break: 50 },
      { player1Points: 8, player2Points: 66, player2Break: 45 },
      { player1Points: 90, player2Points: 5, player1Break: 62 },
      {
        player1Points: 55,
        player2Points: 40,
        player1Break: 25,
        player2Break: 30,
      },
    ]);

    const board = await getMaxBreakLeaderboard();
    expect(board).toMatchObject([
      { rank: 1, userId: p1, maxBreak: 62 },
      { rank: 2, userId: p2, maxBreak: 45 },
    ]);
    expect(board[0]?.tournament.name).toBeTruthy();
    expect(board[0]?.achievedAt).toBeInstanceOf(Date);
  });

  it('ignores draft frames and results awaiting confirmation', async () => {
    const draft = await startedMatch();
    await saveMatchFrame(draft.matchId, 1, {
      player1Points: 100,
      player2Points: 0,
      player1Break: 100,
    });

    const pending = await startedMatch();
    await reportResultFromFrames(pending.matchId, pending.p1, sweep(80));

    expect(await getMaxBreakLeaderboard()).toEqual([]);
  });

  it('shares a rank on equal breaks; the earlier break comes first', async () => {
    const later = await playMatch(sweep(50, 30));
    const earlier = await playMatch(sweep(50));
    await db
      .update(matches)
      .set({ completedAt: new Date('2020-01-01T00:00:00Z') })
      .where(eq(matches.id, earlier.matchId));

    const board = await getMaxBreakLeaderboard();
    expect(board.map((e) => [e.rank, e.userId, e.maxBreak])).toEqual([
      [1, earlier.p1, 50],
      [1, later.p1, 50],
      [3, later.p2, 30],
    ]);
  });

  it('leaves out soft-deleted users', async () => {
    const { p1, p2 } = await playMatch(sweep(60, 40));
    await db
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, p1));

    const board = await getMaxBreakLeaderboard();
    expect(board.map((e) => e.userId)).toEqual([p2]);
  });
});
