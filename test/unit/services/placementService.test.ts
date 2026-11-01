import type { UUID } from 'crypto';

import { describe, expect, it } from 'vitest';

import {
  type BracketMatch,
  generateDoubleEliminationBracket,
  generatePlayoffFromQualifiers,
  generateSingleEliminationBracket,
} from '@/services/bracketGenerator.js';
import {
  computeFinalPlacements,
  type PlacementGroup,
  type PlacementMatch,
} from '@/services/placementService.js';
import type {
  GroupStanding,
  PlayerStanding,
} from '@/services/standingsService.js';

import { makeParticipant, makeParticipants } from '../../helpers/fixtures.js';

type Slot = 'player1' | 'player2';

/**
 * Play a generated bracket to the end, the way matchService advances it:
 * matches in position order (the generator allocates topologically, so every
 * feeder precedes its target), winner to `nextMatchId`, loser to
 * `losersNextMatchPosition`, a lone player beats an empty seat.
 */
function playOut(
  bracket: BracketMatch[],
  pickWinner: (a: UUID, b: UUID) => UUID,
): PlacementMatch[] {
  const byPos = new Map(bracket.map((m) => [m.position, { ...m }]));
  const fill = (pos: number | undefined, slot: Slot | undefined, id: UUID) => {
    const t = pos === undefined ? undefined : byPos.get(pos);
    if (!t) return;
    if (slot === 'player1') t.player1Id = id;
    else t.player2Id = id;
  };
  const empty = (pos: number | undefined, slot: Slot | undefined) => {
    const t = pos === undefined ? undefined : byPos.get(pos);
    if (!t) return;
    if (slot === 'player1') t.player1IsWalkover = true;
    else t.player2IsWalkover = true;
  };

  const out: PlacementMatch[] = [];
  for (const m of [...byPos.values()].sort((a, b) => a.position - b.position)) {
    const base = {
      round: m.round,
      bracketType: m.bracketType,
      phase: m.phase ?? 'playoff',
      status: 'completed',
    } as const;

    if (m.isCompletedWalkover === true) {
      out.push({
        ...base,
        player1Id: m.player1Id,
        player2Id: m.player2Id,
        winnerId: m.walkoverWinnerId ?? null,
      });
      continue;
    }

    const { player1Id: p1, player2Id: p2 } = m;
    if (
      (!p1 && m.player1IsWalkover !== true) ||
      (!p2 && m.player2IsWalkover !== true)
    ) {
      throw new Error(`match ${String(m.position)} has an unfilled seat`);
    }

    let winnerId: UUID | null = null;
    if (p1 && p2) {
      winnerId = pickWinner(p1, p2);
      fill(
        m.losersNextMatchPosition,
        m.losersNextMatchSlot,
        winnerId === p1 ? p2 : p1,
      );
    } else {
      winnerId = p1 ?? p2;
      empty(m.losersNextMatchPosition, m.losersNextMatchSlot);
    }
    if (winnerId) fill(m.nextMatchId, m.nextMatchPosition, winnerId);
    else empty(m.nextMatchId, m.nextMatchPosition);

    out.push({ ...base, player1Id: p1, player2Id: p2, winnerId });
  }
  return out;
}

/** The lower label number wins (p1 is the strongest). */
const strongestWins = (a: UUID, b: UUID): UUID =>
  Number(a.slice(1)) < Number(b.slice(1)) ? a : b;

/** Deterministic pseudo-random winner, to cover upsets. */
function randomWins(seed: number): (a: UUID, b: UUID) => UUID {
  let s = seed;
  return (a, b) => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s % 2 === 0 ? a : b;
  };
}

const sizes = (groups: PlacementGroup[]) => groups.map((g) => g.userIds.length);

/** Places are contiguous from 1 and every player appears exactly once. */
function expectWellFormed(groups: PlacementGroup[], playerCount: number) {
  let next = 1;
  for (const g of groups) {
    expect(g.placeFrom).toBe(next);
    expect(g.placeTo - g.placeFrom + 1).toBe(g.userIds.length);
    next = g.placeTo + 1;
  }
  const ids = groups.flatMap((g) => g.userIds);
  expect(ids).toHaveLength(playerCount);
  expect(new Set(ids).size).toBe(playerCount);
  expect(groups[0]?.userIds).toHaveLength(1);
}

describe('computeFinalPlacements — single elimination', () => {
  it('8 players: 1, 2, 3–4, 5–8', () => {
    const matches = playOut(
      generateSingleEliminationBracket(makeParticipants(8)),
      strongestWins,
    );
    const groups = computeFinalPlacements('single_elimination', matches, []);

    expect(sizes(groups)).toEqual([1, 1, 2, 4]);
    expect(groups[0]?.userIds).toEqual(['p1']);
    expect(groups[1]?.userIds).toEqual(['p2']);
    expect(groups[2]).toMatchObject({ placeFrom: 3, placeTo: 4 });
    expect(groups[3]).toMatchObject({ placeFrom: 5, placeTo: 8 });
  });

  it('6 players with byes: empty seats take no place', () => {
    const matches = playOut(
      generateSingleEliminationBracket(makeParticipants(6)),
      strongestWins,
    );
    const groups = computeFinalPlacements('single_elimination', matches, []);

    expectWellFormed(groups, 6);
    expect(sizes(groups)).toEqual([1, 1, 2, 2]);
  });

  it.each([5, 13, 16, 32])('%i players, random results', (n) => {
    const matches = playOut(
      generateSingleEliminationBracket(makeParticipants(n)),
      randomWins(n),
    );
    expectWellFormed(
      computeFinalPlacements('single_elimination', matches, []),
      n,
    );
  });

  it('throws while the final is not played', () => {
    const matches = playOut(
      generateSingleEliminationBracket(makeParticipants(8)),
      strongestWins,
    );
    const final = matches.reduce((a, b) => (b.round > a.round ? b : a));
    final.status = 'in_progress';
    final.winnerId = null;

    expect(() =>
      computeFinalPlacements('single_elimination', matches, []),
    ).toThrow(/не доиграна/);
  });
});

describe('computeFinalPlacements — double elimination', () => {
  it('16 players, merge round 2: 1, 2, 3–4, 5–8, 9–12, 13–16', () => {
    const matches = playOut(
      generateDoubleEliminationBracket(makeParticipants(16), { mergeRound: 2 }),
      strongestWins,
    );
    const groups = computeFinalPlacements('double_elimination', matches, []);

    expect(sizes(groups)).toEqual([1, 1, 2, 4, 4, 4]);
    expect(groups[0]?.userIds).toEqual(['p1']);
    expectWellFormed(groups, 16);
  });

  it('8 players, full double elimination (merge round = k)', () => {
    const matches = playOut(
      generateDoubleEliminationBracket(makeParticipants(8), { mergeRound: 3 }),
      strongestWins,
    );
    const groups = computeFinalPlacements('double_elimination', matches, []);

    // Grand final loser, then the losers bracket from its last round down.
    expect(sizes(groups)).toEqual([1, 1, 1, 1, 2, 2]);
    expect(groups[0]?.userIds).toEqual(['p1']);
    expect(groups[1]?.userIds).toEqual(['p2']);
  });

  it('upper-bracket losers who reach the merge playoff are not placed early', () => {
    // p2 loses to p1 in the upper bracket, then comes back through the losers
    // bracket — its upper loss must not count as an exit.
    const matches = playOut(
      generateDoubleEliminationBracket(makeParticipants(8), { mergeRound: 3 }),
      strongestWins,
    );
    const groups = computeFinalPlacements('double_elimination', matches, []);
    expect(
      groups.find((g) => g.userIds.includes('p2' as UUID))?.placeFrom,
    ).toBe(2);
  });

  it.each([
    [8, 2],
    [12, 2],
    [12, 3],
    [16, 4],
    [24, 3],
    [32, 2],
  ])('%i players, merge round %i, random results', (n, mergeRound) => {
    const matches = playOut(
      generateDoubleEliminationBracket(makeParticipants(n), { mergeRound }),
      randomWins(n * 10 + mergeRound),
    );
    expectWellFormed(
      computeFinalPlacements('double_elimination', matches, []),
      n,
    );
  });

  it('a stored merge round beyond the bracket size is clamped like the generator', () => {
    // 8 players → k = 3; the generator clamps mergeRound 4 down to 3, and the
    // placement logic derives M from the rows, not from the tournament setting.
    const matches = playOut(
      generateDoubleEliminationBracket(makeParticipants(8), { mergeRound: 4 }),
      strongestWins,
    );
    expect(
      sizes(computeFinalPlacements('double_elimination', matches, [])),
    ).toEqual([1, 1, 1, 1, 2, 2]);
  });
});

function standingRow(userId: string, rank: number): PlayerStanding {
  return {
    userId: userId as UUID,
    seed: null,
    played: 0,
    wins: 0,
    losses: 0,
    framesWon: 0,
    framesLost: 0,
    frameDiff: 0,
    pointsWon: 0,
    pointsLost: 0,
    pointsDiff: 0,
    rank,
  };
}

function group(groupIndex: number, ids: string[]): GroupStanding {
  return {
    groupIndex,
    rows: ids.map((id, i) => standingRow(id, i + 1)),
    pointsComplete: false,
  };
}

describe('computeFinalPlacements — groups + playoff', () => {
  it('ranks group leftovers below the playoff, shared by group place', () => {
    const standings = [
      group(0, ['a1', 'a2', 'a3', 'a4']),
      group(1, ['b1', 'b2', 'b3', 'b4']),
    ];
    const playoff = playOut(
      generatePlayoffFromQualifiers(
        ['a1', 'b2', 'b1', 'a2'].map((id) => makeParticipant(id)),
      ),
      (a, b) => (a.endsWith('1') ? a : b.endsWith('1') ? b : a),
    );
    // A group-stage loss must not count as a playoff exit.
    const groupMatch: PlacementMatch = {
      round: 1,
      bracketType: 'winners',
      phase: 'group',
      status: 'completed',
      player1Id: 'a1' as UUID,
      player2Id: 'a2' as UUID,
      winnerId: 'a2' as UUID,
    };

    const groups = computeFinalPlacements(
      'groups_playoff',
      [groupMatch, ...playoff],
      standings,
    );

    expectWellFormed(groups, 8);
    expect(sizes(groups)).toEqual([1, 1, 2, 2, 2]);
    expect(groups[3]).toMatchObject({ placeFrom: 5, placeTo: 6 });
    expect([...(groups[3]?.userIds ?? [])].sort()).toEqual(['a3', 'b3']);
    expect([...(groups[4]?.userIds ?? [])].sort()).toEqual(['a4', 'b4']);
  });
});

describe('computeFinalPlacements — round robin', () => {
  it('takes the standings rank as the final place', () => {
    const groups = computeFinalPlacements(
      'round_robin',
      [],
      [group(0, ['x', 'y', 'z'])],
    );
    expect(groups).toEqual([
      { placeFrom: 1, placeTo: 1, userIds: ['x'] },
      { placeFrom: 2, placeTo: 2, userIds: ['y'] },
      { placeFrom: 3, placeTo: 3, userIds: ['z'] },
    ]);
  });
});
