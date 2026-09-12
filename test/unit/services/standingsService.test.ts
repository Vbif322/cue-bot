import type { UUID } from 'crypto';

import { describe, expect, it } from 'vitest';

import {
  computeAllStandings,
  computeGroupStanding,
  selectQualifiers,
  clinchedUserIds,
  type GroupStanding,
  type PlayerStanding,
  type StandingMatch,
  type StandingMember,
} from '@/services/standingsService.js';

const u = (id: string): UUID => id as UUID;

function member(id: string, seed: number): StandingMember {
  return { userId: u(id), seed };
}

/** Completed match with the higher score winning. */
function game(p1: string, p2: string, s1: number, s2: number): StandingMatch {
  return {
    player1Id: u(p1),
    player2Id: u(p2),
    winnerId: u(s1 > s2 ? p1 : p2),
    player1Score: s1,
    player2Score: s2,
    status: 'completed',
  };
}

/**
 * Completed match reported frame-by-frame: aggregate frame counts PLUS the summed
 * frame points that `match_frames` would yield.
 */
function frameGame(
  p1: string,
  p2: string,
  s1: number,
  s2: number,
  q1: number,
  q2: number,
): StandingMatch {
  return { ...game(p1, p2, s1, s2), player1Points: q1, player2Points: q2 };
}

/** Order of userIds, best-first (UUID is a string subtype, so compare as strings). */
function order(g: GroupStanding): string[] {
  return g.rows.map((r) => r.userId);
}

describe('computeGroupStanding', () => {
  const members = [member('a', 1), member('b', 2), member('c', 3)];

  it('ranks by match wins', () => {
    const g = computeGroupStanding(0, members, [
      game('a', 'b', 3, 0),
      game('a', 'c', 3, 0),
      game('b', 'c', 3, 0),
    ]);
    expect(order(g)).toEqual(['a', 'b', 'c']);
    expect(g.rows.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('breaks a wins tie by head-to-head (all margins equal)', () => {
    // Full 4-player group; a and b both finish 2-1, c and d both 1-2. Every
    // match is 3-0 so frame diff/frames won are identical within each tie — only
    // head-to-head can separate them. a beat b, c beat d.
    const four = [member('a', 1), member('b', 2), member('c', 3), member('d', 4)];
    const g = computeGroupStanding(0, four, [
      game('a', 'b', 3, 0),
      game('a', 'c', 3, 0),
      game('d', 'a', 3, 0),
      game('b', 'c', 3, 0),
      game('b', 'd', 3, 0),
      game('c', 'd', 3, 0),
    ]);
    expect(order(g)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('breaks a wins tie by frame difference when head-to-head is absent', () => {
    // a and b each win once vs c; they have not played each other.
    const g = computeGroupStanding(0, members, [
      game('a', 'c', 3, 0), // a diff +3
      game('b', 'c', 3, 1), // b diff +2
    ]);
    expect(order(g)).toEqual(['a', 'b', 'c']);
  });

  it('breaks a tie by frames won when wins and frame diff are equal', () => {
    const four = [member('a', 1), member('b', 2), member('c', 3), member('d', 4)];
    // a beats c 5-3 (diff +2, won 5); b beats d 3-1 (diff +2, won 3). a above b.
    const g = computeGroupStanding(0, four, [
      game('a', 'c', 5, 3),
      game('b', 'd', 3, 1),
    ]);
    expect(order(g).slice(0, 2)).toEqual(['a', 'b']);
  });

  it('falls back to best seed when everything else is equal', () => {
    const g = computeGroupStanding(0, [member('b', 2), member('a', 1)], []);
    expect(order(g)).toEqual(['a', 'b']); // seed 1 beats seed 2
  });

  it('resolves a head-to-head cycle by falling through to seed', () => {
    // a>b>c>a, all 3-0: equal wins, equal h2h (1 each), equal frame diff (0) and
    // frames won (3). Only seed decides → a, b, c.
    const g = computeGroupStanding(0, members, [
      game('a', 'b', 3, 0),
      game('b', 'c', 3, 0),
      game('c', 'a', 3, 0),
    ]);
    expect(order(g)).toEqual(['a', 'b', 'c']);
  });

  it('ignores non-completed matches', () => {
    const scheduled: StandingMatch = {
      player1Id: u('a'),
      player2Id: u('b'),
      winnerId: null,
      player1Score: null,
      player2Score: null,
      status: 'scheduled',
    };
    const g = computeGroupStanding(0, members, [scheduled]);
    expect(g.rows.every((r) => r.played === 0)).toBe(true);
  });

  it('leaves points at zero and the gate closed without frame data', () => {
    const g = computeGroupStanding(0, members, [
      game('a', 'c', 3, 0),
      game('b', 'c', 3, 1),
    ]);
    expect(g.pointsComplete).toBe(false);
    expect(g.rows.every((r) => r.pointsWon === 0 && r.pointsLost === 0)).toBe(
      true,
    );
    // Unchanged pre-M2-8 order: frame difference decides.
    expect(order(g)).toEqual(['a', 'b', 'c']);
  });

  it('breaks a tie by points difference when frame difference is equal', () => {
    const four = [member('a', 1), member('b', 2), member('c', 3), member('d', 4)];
    // a and b both win 3-1 (frame diff +2, frames won 3), no head-to-head.
    // b outscored its opponent by more points → b above a despite the better seed.
    const g = computeGroupStanding(0, four, [
      frameGame('a', 'c', 3, 1, 300, 250), // a +50
      frameGame('b', 'd', 3, 1, 400, 200), // b +200
    ]);
    expect(g.pointsComplete).toBe(true);
    expect(order(g).slice(0, 2)).toEqual(['b', 'a']);
  });

  it('applies points AFTER frame difference, BEFORE frames won', () => {
    const four = [member('a', 1), member('b', 2), member('c', 3), member('d', 4)];
    // Frame diff equal (+2). framesWon alone would put a (5) above b (3);
    // points put b above a. Points must win → b first.
    const g = computeGroupStanding(0, four, [
      frameGame('a', 'c', 5, 3, 400, 390), // a +10, frames won 5
      frameGame('b', 'd', 3, 1, 400, 100), // b +300, frames won 3
    ]);
    expect(order(g).slice(0, 2)).toEqual(['b', 'a']);

    // Frame difference still outranks points: a's +3 beats b's +2 regardless.
    const g2 = computeGroupStanding(0, four, [
      frameGame('a', 'c', 3, 0, 300, 290), // frame diff +3, points +10
      frameGame('b', 'd', 3, 1, 400, 100), // frame diff +2, points +300
    ]);
    expect(order(g2).slice(0, 2)).toEqual(['a', 'b']);
  });

  it('closes the gate when one real match lacks frames, restoring the old order', () => {
    const four = [member('a', 1), member('b', 2), member('c', 3), member('d', 4)];
    // Same shape as the "after frame difference" case, but b's match was reported
    // as an aggregate score → points are not comparable, so framesWon decides and
    // a (5 frames won) goes above b (3).
    const g = computeGroupStanding(0, four, [
      frameGame('a', 'c', 5, 3, 400, 390),
      game('b', 'd', 3, 1),
    ]);
    expect(g.pointsComplete).toBe(false);
    expect(order(g).slice(0, 2)).toEqual(['a', 'b']);
  });

  it('keeps the gate open across a structural walkover', () => {
    const walkover: StandingMatch = {
      player1Id: u('a'),
      player2Id: null,
      winnerId: u('a'),
      player1Score: null,
      player2Score: null,
      status: 'completed',
    };
    const g = computeGroupStanding(0, [member('a', 1), member('b', 2)], [
      frameGame('a', 'b', 3, 1, 300, 200),
      walkover,
    ]);
    expect(g.pointsComplete).toBe(true);
    const a = g.rows.find((r) => r.userId === u('a'));
    // The walkover adds nothing on either side.
    expect(a?.pointsWon).toBe(300);
    expect(a?.pointsLost).toBe(200);
    expect(a?.pointsDiff).toBe(100);
  });

  it('closes the gate on a technical result between two real players', () => {
    const g = computeGroupStanding(0, members, [
      frameGame('a', 'b', 3, 1, 300, 200),
      game('a', 'c', 3, 0), // technical win: aggregate score, no frames
    ]);
    expect(g.pointsComplete).toBe(false);
  });

  it('closes the gate when no match has been completed', () => {
    const g = computeGroupStanding(0, members, []);
    expect(g.pointsComplete).toBe(false);
  });

  it('accumulates points slot-wise across several matches', () => {
    // a loses to b but still scores; points follow the slot, not the winner.
    const g = computeGroupStanding(0, members, [
      frameGame('a', 'b', 1, 3, 220, 310),
      frameGame('c', 'a', 0, 3, 90, 260),
    ]);
    const a = g.rows.find((r) => r.userId === u('a'));
    expect(a?.pointsWon).toBe(220 + 260);
    expect(a?.pointsLost).toBe(310 + 90);
    expect(a?.pointsDiff).toBe(80);
  });

  it('counts a walkover (missing opponent) as a win for the present player', () => {
    const walkover: StandingMatch = {
      player1Id: u('a'),
      player2Id: null, // missing slot
      winnerId: u('a'),
      player1Score: null,
      player2Score: null,
      status: 'completed',
    };
    const g = computeGroupStanding(0, [member('a', 1), member('b', 2)], [
      game('a', 'b', 3, 0),
      walkover,
    ]);
    const a = g.rows[0];
    expect(a?.userId).toBe(u('a'));
    expect(a?.played).toBe(2); // real win vs b + walkover win
    expect(a?.wins).toBe(2);
    // The walkover (null) is not a ranked member.
    expect(g.rows).toHaveLength(2);
  });
});

describe('computeAllStandings', () => {
  it('gates each group independently', () => {
    const g0 = [member('a', 1), member('b', 2)];
    const g1 = [member('c', 3), member('d', 4)];
    const standings = computeAllStandings(
      [g0, g1],
      [[frameGame('a', 'b', 3, 1, 300, 200)], [game('c', 'd', 3, 1)]],
    );
    expect(standings.map((g) => g.pointsComplete)).toEqual([true, false]);
    expect(standings.map((g) => g.groupIndex)).toEqual([0, 1]);
  });
});

describe('selectQualifiers', () => {
  function standing(groupIndex: number, ids: string[]): GroupStanding {
    return {
      groupIndex,
      rows: ids.map((id, i) => ({
        userId: u(id),
        seed: i + 1,
        played: 0,
        wins: 0,
        losses: 0,
        framesWon: 0,
        framesLost: 0,
        frameDiff: 0,
        pointsWon: 0,
        pointsLost: 0,
        pointsDiff: 0,
        rank: i + 1,
      })),
      pointsComplete: false,
    };
  }

  it('cross-seeds: group winners first, runners-up rotated by one group', () => {
    const standings = [
      standing(0, ['a1', 'a2', 'a3']),
      standing(1, ['b1', 'b2', 'b3']),
    ];
    // rank0: groups 0,1 → a1, b1; rank1: groups 1,0 → b2, a2.
    const seeded: string[] = selectQualifiers(standings, 2);
    expect(seeded).toEqual(['a1', 'b1', 'b2', 'a2']);
    // The winner and runner-up of group A sit at opposite ends of the seed list.
    expect(seeded.indexOf('a1')).toBe(0);
    expect(seeded.indexOf('a2')).toBe(seeded.length - 1);
  });

  it('takes only the top N of each group', () => {
    const standings = [
      standing(0, ['a1', 'a2', 'a3', 'a4']),
      standing(1, ['b1', 'b2', 'b3', 'b4']),
    ];
    const ids: string[] = selectQualifiers(standings, 1);
    expect(ids).toEqual(['a1', 'b1']);
  });
});

describe('clinchedUserIds', () => {
  // 4-player group → each plays 3 matches.
  const TOTAL = 3;
  function ps(
    id: string,
    rank: number,
    wins: number,
    played: number,
  ): PlayerStanding {
    return {
      userId: u(id),
      seed: rank,
      rank,
      wins,
      losses: played - wins,
      played,
      framesWon: 0,
      framesLost: 0,
      frameDiff: 0,
      pointsWon: 0,
      pointsLost: 0,
      pointsDiff: 0,
    };
  }
  const ids = (s: Set<string>): string[] => [...s].sort();

  it('marks nobody at the start (everything still possible)', () => {
    const rows = [
      ps('a', 1, 0, 0),
      ps('b', 2, 0, 0),
      ps('c', 3, 0, 0),
      ps('d', 4, 0, 0),
    ];
    expect(clinchedUserIds(rows, TOTAL, 2).size).toBe(0);
  });

  it('marks a runaway leader before the group is over', () => {
    const rows = [
      ps('a', 1, 3, 3), // done, 3 wins
      ps('b', 2, 1, 2), // 1 left, max 2
      ps('c', 3, 1, 2),
      ps('d', 4, 0, 1), // 2 left, max 2
    ];
    expect(ids(clinchedUserIds(rows, TOTAL, 2))).toEqual(['a']);
  });

  it('reduces to top-N by rank once the group is complete', () => {
    const rows = [
      ps('a', 1, 3, 3),
      ps('b', 2, 2, 3),
      ps('c', 3, 1, 3),
      ps('d', 4, 0, 3),
    ];
    expect(ids(clinchedUserIds(rows, TOTAL, 2))).toEqual(['a', 'b']);
  });

  it('resolves a final win-tie at the cutline by rank', () => {
    // b and c both finished on 2 wins; tiebreak ranked b above c.
    const rows = [
      ps('a', 1, 3, 3),
      ps('b', 2, 2, 3),
      ps('c', 3, 2, 3),
      ps('d', 4, 1, 3),
    ];
    expect(ids(clinchedUserIds(rows, TOTAL, 2))).toEqual(['a', 'b']);
  });
});
