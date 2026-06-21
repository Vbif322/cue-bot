import type { UUID } from 'crypto';

import { describe, expect, it } from 'vitest';

import {
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
        rank: i + 1,
      })),
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
