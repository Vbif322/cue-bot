import type { UUID } from 'crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { getBracketReadModel } from '@/services/bracketReadService.js';
import { getRoundRobinStandings } from '@/services/groupPhaseService.js';
import {
  confirmResult,
  getTournamentMatches,
  reportResultFromFrames,
} from '@/services/matchService.js';

import {
  completeMatch,
  createMatchesForTournament,
  createTournamentWithParticipants,
} from '../helpers/factories.js';
import { must } from '../helpers/must.js';
import { truncateAll } from '../helpers/truncate.js';

/** A started round-robin tournament with `count` seeded confirmed participants. */
async function makeRoundRobin(count: number, start = true) {
  const { tournament, participantIds } = await createTournamentWithParticipants(
    count,
    'round_robin',
  );
  if (start) await createMatchesForTournament(tournament.id, 'round_robin');
  return { tournament, participantIds };
}

/** The round-robin match between two players (order-insensitive). */
async function findMatch(tournamentId: UUID, x: UUID, y: UUID) {
  const all = await getTournamentMatches(tournamentId);
  const m = all.find(
    (c) =>
      (c.player1Id === x && c.player2Id === y) ||
      (c.player1Id === y && c.player2Id === x),
  );
  if (!m) throw new Error('no match between the two players');
  return m;
}

/**
 * Play a match 3-1 through the snooker frame path, `winnerId` taking every won
 * frame by exactly `margin` points (so the match points difference is 2×margin).
 */
async function playWithFrames(
  tournamentId: UUID,
  x: UUID,
  y: UUID,
  winnerId: UUID,
  margin: number,
): Promise<void> {
  const match = await findMatch(tournamentId, x, y);
  const winnerIsP1 = match.player1Id === winnerId;
  const hi = 60;
  const lo = hi - margin;
  const frames = [true, true, true, false].map((winnerTakesIt) => {
    const winnerPts = winnerTakesIt ? hi : lo;
    const loserPts = winnerTakesIt ? lo : hi;
    return winnerIsP1
      ? { player1Points: winnerPts, player2Points: loserPts }
      : { player1Points: loserPts, player2Points: winnerPts };
  });
  const loserId = winnerIsP1
    ? must(match.player2Id, 'player2Id')
    : must(match.player1Id, 'player1Id');
  const reported = await reportResultFromFrames(match.id, loserId, frames);
  if (!reported.success) throw new Error(reported.error ?? 'report failed');
  const confirmed = await confirmResult(match.id, winnerId);
  if (!confirmed.success) throw new Error(confirmed.error ?? 'confirm failed');
}

describe('round-robin standings (M2-8)', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('lists every confirmed participant on zeroes before a single match is played', async () => {
    const { tournament, participantIds } = await makeRoundRobin(4, false);

    const standings = await getRoundRobinStandings(tournament.id);
    expect(standings).toHaveLength(1);
    const table = must(standings[0], 'standing');
    expect(table.groupIndex).toBe(0);
    // Seed order, all-zero rows, ranks 1..4.
    expect(table.rows.map((r) => r.userId)).toEqual(participantIds);
    expect(table.rows.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    for (const row of table.rows) {
      expect(row).toMatchObject({
        played: 0,
        wins: 0,
        losses: 0,
        framesWon: 0,
        framesLost: 0,
        frameDiff: 0,
      });
    }
    expect(table.pointsComplete).toBe(false);
  });

  it('counts wins and frames from completed matches and ranks by them', async () => {
    const { tournament, participantIds } = await makeRoundRobin(4);
    const [p1, p2, p3, p4] = participantIds as [UUID, UUID, UUID, UUID];

    // p1 beats everyone (3 wins), p2 beats p3 and p4 (2 wins), p3 beats p4 (1).
    for (const loser of [p2, p3, p4]) {
      await completeMatch((await findMatch(tournament.id, p1, loser)).id, p1);
    }
    for (const loser of [p3, p4]) {
      await completeMatch((await findMatch(tournament.id, p2, loser)).id, p2);
    }
    await completeMatch((await findMatch(tournament.id, p3, p4)).id, p3);

    const table = must(
      (await getRoundRobinStandings(tournament.id))[0],
      'standing',
    );
    expect(table.rows.map((r) => r.userId)).toEqual([p1, p2, p3, p4]);
    expect(table.rows.map((r) => r.wins)).toEqual([3, 2, 1, 0]);
    expect(table.rows.map((r) => r.losses)).toEqual([0, 1, 2, 3]);
    expect(table.rows.map((r) => r.played)).toEqual([3, 3, 3, 3]);
    // completeMatch reports winScore-0 (default winScore 3).
    expect(table.rows.map((r) => r.framesWon)).toEqual([9, 6, 3, 0]);
    expect(table.rows.map((r) => r.framesLost)).toEqual([0, 3, 6, 9]);
    expect(table.rows.map((r) => r.frameDiff)).toEqual([9, 3, -3, -9]);
  });

  it('reads frame points across the whole tournament and breaks ties by them', async () => {
    const { tournament, participantIds } = await makeRoundRobin(3);
    const [p1, p2, p3] = participantIds as [UUID, UUID, UUID];

    // A head-to-head cycle, every match 3-1: wins, h2h and frame difference are all
    // level, so only the points difference can separate the three. Margins put p3
    // first and p1 last — the reverse of the seed order that would otherwise decide.
    await playWithFrames(tournament.id, p1, p2, p1, 2);
    await playWithFrames(tournament.id, p2, p3, p2, 6);
    await playWithFrames(tournament.id, p3, p1, p3, 12);

    const table = must(
      (await getRoundRobinStandings(tournament.id))[0],
      'standing',
    );
    // Round-robin matches carry phase 'playoff', so a group-only frame query would
    // see nothing here — this is the regression guard for that filter.
    expect(table.pointsComplete).toBe(true);
    expect(table.rows.map((r) => r.wins)).toEqual([1, 1, 1]);
    // Everyone won 3 frames and lost 3 — the frame difference cannot separate them.
    expect(table.rows.map((r) => r.frameDiff)).toEqual([0, 0, 0]);
    // A player gains 2×margin in the match they won and loses 2×margin in the one
    // they lost: p3 = 24−12, p2 = 12−4, p1 = 4−24.
    expect(table.rows.map((r) => r.userId)).toEqual([p3, p2, p1]);
    expect(table.rows.map((r) => r.pointsDiff)).toEqual([12, 8, -20]);
  });

  it('exposes the standings through the bracket read-model, with player names', async () => {
    const { tournament, participantIds } = await makeRoundRobin(3);
    const [p1, p2] = participantIds as [UUID, UUID, UUID];
    await completeMatch((await findMatch(tournament.id, p1, p2)).id, p1);

    const model = must(await getBracketReadModel(tournament.id), 'read-model');
    expect(model.standings).toHaveLength(1);
    const rows = must(model.standings[0], 'standing').rows;
    expect(rows).toHaveLength(3);
    // Every row must be resolvable to a player for the web table.
    for (const row of rows) expect(model.playerMap.has(row.userId)).toBe(true);
  });
});
