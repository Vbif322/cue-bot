import type { UUID } from 'crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { generateBracket } from '@/services/bracketGenerator.js';
import {
  createMatches,
  getTournamentMatches,
  checkTournamentCompletion,
  correctMatchResult,
  previewCorrection,
  reportResultFromFrames,
  reportResult,
  confirmResult,
} from '@/services/matchService.js';
import {
  getConfirmedParticipantsBySeed,
  getTournament,
  startTournament,
  canStartTournament,
} from '@/services/tournamentService.js';
import { getGroupStandings } from '@/services/groupPhaseService.js';

import {
  completeMatch,
  createTournament,
  createConfirmedParticipant,
} from '../helpers/factories.js';
import { must } from '../helpers/must.js';
import { truncateAll } from '../helpers/truncate.js';

const GROUP_CONFIG = {
  groupsCount: 2,
  participantsPerGroup: 4,
  qualifiersPerGroup: 2,
  groupDraw: 'snake' as const,
};

/** Create a groups_playoff tournament with `count` seeded confirmed participants. */
async function makeGroupsTournament(count: number, status = 'registration_open') {
  const tournament = await createTournament({
    format: 'groups_playoff',
    status: status as 'registration_open',
    ...GROUP_CONFIG,
  });
  for (let seed = 1; seed <= count; seed++) {
    await createConfirmedParticipant(tournament.id, { seed });
  }
  return tournament;
}

/** Generate + persist the group phase headlessly and flip to in_progress. */
async function startGroupPhase(tournamentId: UUID) {
  const participants = await getConfirmedParticipantsBySeed(tournamentId);
  const bracket = generateBracket('groups_playoff', participants, false, 2, {
    groupsCount: GROUP_CONFIG.groupsCount,
    participantsPerGroup: GROUP_CONFIG.participantsPerGroup,
    groupDraw: GROUP_CONFIG.groupDraw,
  });
  await createMatches(tournamentId, bracket);
  await startTournament(tournamentId);
}

/** Complete every still-open match of the given phase (player1 wins each). */
async function completePhase(tournamentId: UUID, phase: 'group' | 'playoff') {
  for (let i = 0; i < 200; i++) {
    const all = await getTournamentMatches(tournamentId);
    const ready = all.find(
      (m) =>
        m.phase === phase &&
        m.player1Id !== null &&
        m.player2Id !== null &&
        (m.status === 'scheduled' || m.status === 'in_progress'),
    );
    if (!ready) break;
    await completeMatch(ready.id, must(ready.player1Id, 'player1Id'));
  }
}

describe('groups_playoff lifecycle', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('generates the playoff only after the group phase finishes, then completes', async () => {
    const t = await makeGroupsTournament(8);
    await startGroupPhase(t.id);

    // Group phase only: 2 groups × C(4,2) = 12 matches, no playoff yet.
    let all = await getTournamentMatches(t.id);
    expect(all).toHaveLength(12);
    expect(all.every((m) => m.phase === 'group')).toBe(true);
    expect(all.filter((m) => m.groupIndex === 0)).toHaveLength(6);
    expect(all.filter((m) => m.groupIndex === 1)).toHaveLength(6);
    expect(await checkTournamentCompletion(t.id)).toBe(false);

    // Play out the groups → triggers the transition on the last confirmation.
    await completePhase(t.id, 'group');

    // Standings are computed per group with full, ranked rows.
    const standings = await getGroupStandings(t.id);
    expect(standings).toHaveLength(2);
    for (const g of standings) {
      expect(g.rows).toHaveLength(4);
      expect(g.rows.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    }

    all = await getTournamentMatches(t.id);
    const playoff = all.filter((m) => m.phase === 'playoff');
    // 2 groups × 2 qualifiers = 4 → single-elim of 4 = 3 matches.
    expect(playoff).toHaveLength(3);
    expect((await getTournament(t.id))?.status).toBe('in_progress');
    // Not complete yet: the playoff final has not been played.
    expect(await checkTournamentCompletion(t.id)).toBe(false);

    // Play out the playoff → tournament completes.
    await completePhase(t.id, 'playoff');
    expect((await getTournament(t.id))?.status).toBe('completed');
    expect(await checkTournamentCompletion(t.id)).toBe(true);
  });

  it('is idempotent: re-running the transition does not duplicate the playoff', async () => {
    const t = await makeGroupsTournament(8);
    await startGroupPhase(t.id);
    await completePhase(t.id, 'group');

    const before = (await getTournamentMatches(t.id)).filter(
      (m) => m.phase === 'playoff',
    ).length;

    const { maybeStartPlayoffPhase } =
      await import('@/services/tournamentStartService.js');
    const created = await maybeStartPlayoffPhase(t.id);
    expect(created).toBe(false);

    const after = (await getTournamentMatches(t.id)).filter(
      (m) => m.phase === 'playoff',
    ).length;
    expect(after).toBe(before);
  });

  it('locks group results once the playoff has started', async () => {
    const t = await makeGroupsTournament(8);
    await startGroupPhase(t.id);

    // A completed group match is correctable before the playoff exists.
    const groupMatch = (await getTournamentMatches(t.id)).find(
      (m) => m.phase === 'group',
    );
    if (!groupMatch) throw new Error('no group match');
    await completeMatch(groupMatch.id, must(groupMatch.player1Id, 'player1Id'));
    const preBefore = await previewCorrection(groupMatch.id, 0, 3);
    expect(preBefore.valid).toBe(true);

    // Finish the groups → playoff generated → group results lock.
    await completePhase(t.id, 'group');

    const preAfter = await previewCorrection(groupMatch.id, 0, 3);
    expect(preAfter.valid).toBe(false);

    const corrected = await correctMatchResult(
      groupMatch.id,
      0,
      3,
      'test',
      must(groupMatch.player1Id, 'player1Id'),
    );
    expect(corrected.success).toBe(false);
  });

  it('allows under-filled groups (walkover padding) within bounds', async () => {
    // 2 groups × 4, 2 qualify. 8 = full, 6 = under-filled (ok, walkovers),
    // 9 = too many, 2 = too few (smallest group < qualifiers).
    const full = await makeGroupsTournament(8, 'registration_closed');
    expect((await canStartTournament(full.id)).canStart).toBe(true);

    const under = await makeGroupsTournament(6, 'registration_closed');
    expect((await canStartTournament(under.id)).canStart).toBe(true);

    const tooMany = await makeGroupsTournament(9, 'registration_closed');
    expect((await canStartTournament(tooMany.id)).canStart).toBe(false);

    const tooFew = await makeGroupsTournament(2, 'registration_closed');
    expect((await canStartTournament(tooFew.id)).canStart).toBe(false);
  });

  it('runs an under-filled tournament: walkover matches auto-complete', async () => {
    // 2 groups × 4 with 6 players → snake 3 + 3, each group gets 1 walkover slot.
    const t = await makeGroupsTournament(6);
    await startGroupPhase(t.id);

    const all = await getTournamentMatches(t.id);
    // 2 groups × C(4,2) = 12 rows; the two walkover slots each auto-win vs 3 reals.
    expect(all).toHaveLength(12);
    const walkovers = all.filter((m) => m.status === 'completed');
    expect(walkovers.length).toBe(6); // 3 per group, pre-completed at creation

    // Standings still rank only the real players.
    const standings = await getGroupStandings(t.id);
    expect(standings).toHaveLength(2);
    for (const g of standings) {
      expect(g.rows).toHaveLength(3);
    }

    // Play the remaining real matches → playoff generates → tournament completes.
    await completePhase(t.id, 'group');
    expect(
      (await getTournamentMatches(t.id)).some((m) => m.phase === 'playoff'),
    ).toBe(true);
    await completePhase(t.id, 'playoff');
    expect((await getTournament(t.id))?.status).toBe('completed');
  });
});

/**
 * M2-8: the points difference tiebreak. It only ever fires on a 3+-way tie — in a
 * full round-robin any two tied players HAVE met, so head-to-head separates them
 * first. A head-to-head cycle (a>b>c>a) is the realistic path to it.
 */
describe('group standings: points-difference tiebreak', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  /** The group-0 members, ordered by seed (best seed first). */
  async function groupZeroPlayers(tournamentId: UUID): Promise<UUID[]> {
    const all = await getTournamentMatches(tournamentId);
    const seeds = await getConfirmedParticipantsBySeed(tournamentId);
    const rank = new Map(seeds.map((p, i) => [p.userId, i]));
    const ids = new Set<UUID>();
    for (const m of all.filter((x) => x.groupIndex === 0)) {
      if (m.player1Id) ids.add(m.player1Id);
      if (m.player2Id) ids.add(m.player2Id);
    }
    return [...ids].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
  }

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
    // 3 frames to the winner, 1 to the loser.
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
    if (!confirmed.success)
      throw new Error(confirmed.error ?? 'confirm failed');
  }

  /**
   * Drive group 0 into a 3-way head-to-head cycle (a>b>c>a, all three beating d)
   * with every match 3-1, so wins, head-to-head and frame difference are all level
   * for a/b/c and only the points difference can separate them.
   *
   * Margins are chosen so the points order is c > b > a — the exact reverse of the
   * seed order, which is what would decide the tie without this feature.
   */
  async function playCyclicGroup(
    tournamentId: UUID,
    opts: { skipFramesOnAB?: boolean } = {},
  ): Promise<{ a: UUID; b: UUID; c: UUID; d: UUID }> {
    const [a, b, c, d] = await groupZeroPlayers(tournamentId);
    if (!a || !b || !c || !d) throw new Error('group 0 is not full');

    if (opts.skipFramesOnAB === true) {
      // Aggregate report: the SAME 3-1 scoreline, just without frame rows — so
      // wins, head-to-head and frame difference stay level and only the missing
      // points data can change the outcome.
      const ab = await findMatch(tournamentId, a, b);
      const aIsP1 = ab.player1Id === a;
      const loserId = aIsP1
        ? must(ab.player2Id, 'player2Id')
        : must(ab.player1Id, 'player1Id');
      const reported = await reportResult(
        ab.id,
        loserId,
        aIsP1 ? 3 : 1,
        aIsP1 ? 1 : 3,
      );
      if (!reported.success) throw new Error(reported.error ?? 'report failed');
      const confirmed = await confirmResult(ab.id, a);
      if (!confirmed.success) throw new Error(confirmed.error ?? 'confirm');
    } else {
      await playWithFrames(tournamentId, a, b, a, 10);
    }
    await playWithFrames(tournamentId, b, c, b, 10);
    await playWithFrames(tournamentId, c, a, c, 50);
    await playWithFrames(tournamentId, a, d, a, 10);
    await playWithFrames(tournamentId, b, d, b, 10);
    await playWithFrames(tournamentId, c, d, c, 10);
    return { a, b, c, d };
  }

  it('separates a head-to-head cycle by real frame points', async () => {
    const t = await makeGroupsTournament(8);
    await startGroupPhase(t.id);
    const { a, b, c } = await playCyclicGroup(t.id);

    const group = must(
      (await getGroupStandings(t.id)).find((g) => g.groupIndex === 0),
      'group 0',
    );
    expect(group.pointsComplete).toBe(true);

    // Wins, head-to-head and frame difference are all level for a/b/c.
    const top3 = group.rows.slice(0, 3);
    expect(top3.every((r) => r.wins === 2)).toBe(true);
    expect(top3.every((r) => r.frameDiff === 2)).toBe(true);

    // Points decide, reversing the seed order.
    expect(top3.map((r) => r.userId)).toEqual([c, b, a]);
    const rowC = must(top3[0], 'row c');
    // 3-1 with a 50-point margin vs a, 10 vs b and d: +100 −20 +20 = +100.
    expect(rowC.pointsDiff).toBe(100);
    expect(rowC.pointsWon - rowC.pointsLost).toBe(rowC.pointsDiff);
    // sum(int4) is bigint in Postgres — prove the ::int cast really yields numbers.
    expect(typeof rowC.pointsDiff).toBe('number');
  });

  it('ignores points when one group match was reported as an aggregate score', async () => {
    const t = await makeGroupsTournament(8);
    await startGroupPhase(t.id);
    const { a, b, c } = await playCyclicGroup(t.id, { skipFramesOnAB: true });

    const group = must(
      (await getGroupStandings(t.id)).find((g) => g.groupIndex === 0),
      'group 0',
    );
    expect(group.pointsComplete).toBe(false);
    // Everything above points is still level for the trio...
    const top3 = group.rows.slice(0, 3);
    expect(top3.every((r) => r.wins === 2)).toBe(true);
    expect(top3.every((r) => r.frameDiff === 2)).toBe(true);
    // ...so without comparable points it falls through to frames won (equal) and
    // then to seed — exactly the pre-M2-8 order, the reverse of the points order.
    expect(top3.map((r) => r.userId)).toEqual([a, b, c]);
  });

  it('keeps points comparable in an under-filled group (walkover padding)', async () => {
    // 6 players → 3 per group, each group also holds 3 completed walkover rows.
    const t = await makeGroupsTournament(6);
    await startGroupPhase(t.id);
    const players = await groupZeroPlayers(t.id);
    const [a, b, c] = players;
    if (!a || !b || !c) throw new Error('group 0 is not full');

    await playWithFrames(t.id, a, b, a, 10);
    await playWithFrames(t.id, b, c, b, 10);
    await playWithFrames(t.id, c, a, c, 50);

    const group = must(
      (await getGroupStandings(t.id)).find((g) => g.groupIndex === 0),
      'group 0',
    );
    expect(group.pointsComplete).toBe(true);
    // The walkover win contributes nothing on either side of the points ledger.
    const rowC = must(
      group.rows.find((r) => r.userId === c),
      'row c',
    );
    expect(rowC.played).toBe(3); // 2 real + 1 walkover
    expect(rowC.pointsWon).toBe(240 - 50 + (240 - 3 * 10));
  });

  it('closes the gate when an admin correction deletes a match breakdown', async () => {
    const t = await makeGroupsTournament(8);
    await startGroupPhase(t.id);
    const { a, b } = await playCyclicGroup(t.id);

    const before = must(
      (await getGroupStandings(t.id)).find((g) => g.groupIndex === 0),
      'group 0',
    );
    expect(before.pointsComplete).toBe(true);

    // Group 1 is still unplayed, so the playoff has not started and group results
    // are still correctable. A correction drops the stale frame breakdown.
    const ab = await findMatch(t.id, a, b);
    const corrected = await correctMatchResult(
      ab.id,
      ab.player1Id === a ? 3 : 1,
      ab.player1Id === a ? 1 : 3,
      'test',
      a,
    );
    expect(corrected.success).toBe(true);

    const after = must(
      (await getGroupStandings(t.id)).find((g) => g.groupIndex === 0),
      'group 0',
    );
    expect(after.pointsComplete).toBe(false);
  });

  it('sends the points winner into the playoff', async () => {
    const t = await makeGroupsTournament(8);
    await startGroupPhase(t.id);
    const { c } = await playCyclicGroup(t.id);
    // Finish group 1 too → the playoff is generated from the group standings.
    await completePhase(t.id, 'group');

    const playoff = (await getTournamentMatches(t.id)).filter(
      (m) => m.phase === 'playoff',
    );
    expect(playoff.length).toBeGreaterThan(0);
    const qualified = new Set(
      playoff.flatMap((m) => [m.player1Id, m.player2Id]).filter(Boolean),
    );
    // c finished 1st on points despite the worst seed of the tied trio.
    expect(qualified.has(c)).toBe(true);
  });
});
