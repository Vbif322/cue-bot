import type { UUID } from 'crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type BracketMatch,
  assignParticipantsToGroups,
  calculateRounds,
  generateBracket,
  generateDoubleEliminationBracket,
  generateGroupStageMatches,
  generatePlayoffFromQualifiers,
  generateRoundRobinMatches,
  generateSeedPositions,
  generateSingleEliminationBracket,
  getBracketStats,
  getNextPowerOfTwo,
  getRoundName,
  shuffleArray,
} from '@/services/bracketGenerator.js';

import { makeParticipants } from '../../helpers/fixtures.js';

describe('getNextPowerOfTwo', () => {
  it.each([
    [0, 1],
    [1, 1],
    [2, 2],
    [3, 4],
    [4, 4],
    [5, 8],
    [8, 8],
    [9, 16],
    [16, 16],
    [17, 32],
  ])('getNextPowerOfTwo(%i) = %i', (input, expected) => {
    expect(getNextPowerOfTwo(input)).toBe(expected);
  });
});

describe('calculateRounds', () => {
  it.each([
    [2, 1],
    [4, 2],
    [8, 3],
    [16, 4],
  ])('calculateRounds(%i) = %i', (size, rounds) => {
    expect(calculateRounds(size)).toBe(rounds);
  });
});

describe('generateSeedPositions', () => {
  it('returns [1,2] for size 2', () => {
    expect(generateSeedPositions(2)).toEqual([1, 2]);
  });

  it('returns [1,4,2,3] for size 4', () => {
    expect(generateSeedPositions(4)).toEqual([1, 4, 2, 3]);
  });

  it('returns the documented order for size 8', () => {
    expect(generateSeedPositions(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it('is a permutation of 1..N with no duplicates (size 16)', () => {
    const seeds = generateSeedPositions(16);
    expect(seeds).toHaveLength(16);
    expect([...seeds].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 16 }, (_, i) => i + 1),
    );
    // High seeds meet last: seed 1 and seed 2 sit in opposite halves.
    expect(seeds.indexOf(1)).toBeLessThan(8);
    expect(seeds.indexOf(2)).toBeGreaterThanOrEqual(8);
  });
});

describe('shuffleArray', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not mutate the input and preserves the multiset', () => {
    const input = [1, 2, 3, 4, 5];
    const copy = [...input];
    const out = shuffleArray(input);
    expect(input).toEqual(copy); // original untouched
    expect(out).not.toBe(input); // new array
    expect([...out].sort((a, b) => a - b)).toEqual(copy);
  });

  it('is deterministic given a fixed RNG', () => {
    // Math.random() -> 0 makes Fisher-Yates swap every index with index 0.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(shuffleArray(['a', 'b', 'c', 'd'])).toEqual(['b', 'c', 'd', 'a']);
  });
});

/** Assert every match links into a real downstream slot and the final is terminal. */
function assertWinnersConnectivity(matches: BracketMatch[]): void {
  const positions = new Set(matches.map((m) => m.position));
  for (const m of matches) {
    if (m.nextMatchId !== undefined) {
      expect(
        positions.has(m.nextMatchId),
        `match at position ${String(m.position)} points to non-existent nextMatchId ${String(m.nextMatchId)}`,
      ).toBe(true);
    }
  }
}

/**
 * Assert a single-elimination winners bracket is structurally sound: the right
 * match count, a single terminal final, and every downstream (round >= 2) match
 * fed by exactly two upstream matches occupying distinct player slots — no
 * collisions, no orphans. Stronger than connectivity, which only checks that
 * links point at *some* existing position.
 */
function assertSingleElimTopology(
  matches: BracketMatch[],
  bracketSize: number,
): void {
  assertWinnersConnectivity(matches);

  expect(matches).toHaveLength(bracketSize - 1);

  const terminal = matches.filter((m) => m.nextMatchId === undefined);
  expect(
    terminal,
    'exactly one match should be terminal (the final)',
  ).toHaveLength(1);

  for (const m of matches) {
    const feeders = matches.filter((f) => f.nextMatchId === m.position);
    if (m.round === 1) {
      expect(
        feeders,
        `round-1 match at position ${String(m.position)} should have no feeders`,
      ).toHaveLength(0);
    } else {
      expect(
        feeders.map((f) => f.nextMatchPosition).sort(),
        `match at position ${String(m.position)} should be fed by exactly two matches in distinct slots`,
      ).toEqual(['player1', 'player2']);
    }
  }
}

describe('generateSingleEliminationBracket', () => {
  it('creates bracketSize-1 matches with a correct round 1 for 8 players', () => {
    const matches = generateSingleEliminationBracket(makeParticipants(8));
    expect(matches).toHaveLength(7);
    const round1 = matches.filter((m) => m.round === 1);
    expect(round1).toHaveLength(4);
    // Top seed (p1) faces lowest (p8) in the first match per seed positions.
    const m0 = round1[0];
    if (!m0) throw new Error('round1[0] expected');
    expect(m0.player1Id).toBe('p1');
    expect(m0.player2Id).toBe('p8');
  });

  it('auto-advances a player who has a BYE in round 1', () => {
    // 5 players in an 8-slot bracket => 3 byes. p1 (seed 1) gets a bye.
    const matches = generateSingleEliminationBracket(makeParticipants(5));
    const firstMatch = matches.find((m) => m.round === 1 && m.position === 1);
    if (!firstMatch) throw new Error('firstMatch expected');
    expect(firstMatch.player1Id).toBe('p1');
    expect(firstMatch.player2Id).toBeNull(); // bye
    // The bye seat is resolved as a completed walkover (mirrors double-elim).
    expect(firstMatch.isCompletedWalkover).toBe(true);
    expect(firstMatch.walkoverWinnerId).toBe('p1');
    expect(firstMatch.player2IsWalkover).toBe(true);
    // p1 should already be seeded into its round-2 match.
    const next = matches.find((m) => m.position === firstMatch.nextMatchId);
    if (!next) throw new Error('next match expected');
    expect([next.player1Id, next.player2Id]).toContain('p1');
  });

  it('links every match into an existing downstream slot (4 players)', () => {
    assertWinnersConnectivity(generateSingleEliminationBracket(makeParticipants(4)));
  });

  it('links every match with correct topology (8 players)', () => {
    assertSingleElimTopology(
      generateSingleEliminationBracket(makeParticipants(8)),
      8,
    );
  });

  it('links every match with correct topology (16 players)', () => {
    assertSingleElimTopology(
      generateSingleEliminationBracket(makeParticipants(16)),
      16,
    );
  });

  it('clears deterministic pointers in random-advancement mode', () => {
    const matches = generateSingleEliminationBracket(makeParticipants(8), {
      randomAdvancement: true,
    });
    // Same bracket size/rounds as the deterministic variant, just unrouted.
    expect(matches).toHaveLength(7);
    expect(matches.filter((m) => m.round === 1)).toHaveLength(4);
    for (const m of matches) {
      expect(m.nextMatchId).toBeUndefined();
      expect(m.nextMatchPosition).toBeUndefined();
      expect(m.bracketType).toBe('winners');
    }
  });

  it('still seeds BYE winners into round 2 in random-advancement mode', () => {
    // 5 players in an 8-slot bracket => p1 gets a bye and must already sit in R2.
    const matches = generateSingleEliminationBracket(makeParticipants(5), {
      randomAdvancement: true,
    });
    const round2 = matches.filter((m) => m.round === 2);
    const seeded = round2.some(
      (m) => m.player1Id === ('p1' as UUID) || m.player2Id === ('p1' as UUID),
    );
    expect(seeded).toBe(true);
  });
});

/**
 * Assert a generalized double-elimination bracket (bracket size N, merge round M)
 * is structurally sound: right total/losers counts, exactly one terminal match,
 * every pointer topological (target position strictly later) and targeting an
 * existing slot, and no two pointers colliding on the same (position, slot).
 * With no byes every non-seed slot is filled by exactly one pointer.
 */
function assertDoubleElimTopology(
  matches: BracketMatch[],
  bracketSize: number,
  mergeRound: number,
): void {
  const N = bracketSize;
  const M = mergeRound;

  expect(matches).toHaveLength(2 * N - N / 2 ** M - 1);

  const losers = matches.filter((m) => m.bracketType === 'losers');
  expect(losers).toHaveLength(N - N / 2 ** (M - 1));
  expect(new Set(losers.map((m) => m.round)).size).toBe(2 * (M - 1));

  const byPos = new Map(matches.map((m) => [m.position, m]));

  const terminal = matches.filter((m) => m.nextMatchId === undefined);
  expect(terminal, 'exactly one terminal match').toHaveLength(1);
  expect(terminal[0]?.bracketType).not.toBe('losers');

  const occupied = new Set<string>();
  const claim = (pos: number | undefined, slot: unknown): void => {
    if (pos === undefined) throw new Error('pointer with no position');
    expect(byPos.has(pos), `pointer to missing position ${String(pos)}`).toBe(true);
    expect(slot === 'player1' || slot === 'player2', 'pointer missing slot').toBe(true);
    const key = `${String(pos)}:${String(slot)}`;
    expect(occupied.has(key), `slot collision at ${key}`).toBe(false);
    occupied.add(key);
  };

  for (const m of matches) {
    if (m.nextMatchId !== undefined) {
      expect(m.nextMatchId, `winner pointer not topological at pos ${String(m.position)}`).toBeGreaterThan(m.position);
      claim(m.nextMatchId, m.nextMatchPosition);
    }
    if (m.losersNextMatchPosition !== undefined) {
      expect(m.losersNextMatchPosition, `loser pointer not topological at pos ${String(m.position)}`).toBeGreaterThan(m.position);
      claim(m.losersNextMatchPosition, m.losersNextMatchSlot);
    }
  }

  // Every non-(round-1-upper) slot is filled by exactly one pointer (no byes).
  const round1Upper = matches.filter(
    (m) => m.bracketType === 'winners' && m.round === 1,
  ).length;
  expect(occupied.size).toBe(2 * (matches.length - round1Upper));
}

describe('generateDoubleEliminationBracket', () => {
  it('throws outside the 8..128 participant range', () => {
    expect(() => generateDoubleEliminationBracket(makeParticipants(7))).toThrow();
    expect(() => generateDoubleEliminationBracket(makeParticipants(129))).toThrow();
  });

  it.each([
    [8, 2],
    [8, 3],
    [16, 2],
    [16, 3],
    [16, 4],
    [32, 2],
    [32, 5],
  ])('has sound topology for N=%i, mergeRound=%i', (n, m) => {
    const matches = generateDoubleEliminationBracket(makeParticipants(n), {
      mergeRound: m,
    });
    assertDoubleElimTopology(matches, n, m);
  });

  it('reproduces the historical 27-match layout for 16 players (mergeRound 2)', () => {
    const matches = generateDoubleEliminationBracket(makeParticipants(16));
    expect(matches).toHaveLength(27);
    expect(
      matches.filter((m) => m.round === 1 && m.bracketType === 'winners'),
    ).toHaveLength(8);
    expect(matches.filter((m) => m.bracketType === 'losers')).toHaveLength(8);

    const at = (pos: number): BracketMatch => {
      const m = matches.find((match) => match.position === pos);
      if (!m) throw new Error(`match at position ${String(pos)} not found`);
      return m;
    };
    // R1 upper pos1,2 -> R2 upper pos13 (player1 / player2)
    expect(at(1).nextMatchId).toBe(13);
    expect(at(1).nextMatchPosition).toBe('player1');
    expect(at(2).nextMatchId).toBe(13);
    expect(at(2).nextMatchPosition).toBe('player2');
    // R1 upper losers -> R1 lower (pos9), with slots
    expect(at(1).losersNextMatchPosition).toBe(9);
    expect(at(1).losersNextMatchSlot).toBe('player1');
    expect(at(2).losersNextMatchPosition).toBe(9);
    expect(at(2).losersNextMatchSlot).toBe('player2');
    // R2 upper loser -> R2 lower as player2; final at pos 27
    expect(at(13).losersNextMatchPosition).toBe(17);
    expect(at(13).losersNextMatchSlot).toBe('player2');
    expect(at(25).nextMatchId).toBe(27);
    expect(at(26).nextMatchId).toBe(27);
    expect(at(27).nextMatchId).toBeUndefined();
    expect(at(27).round).toBe(5);
  });

  it('is a full double elimination at mergeRound=k (8 players => 14 matches)', () => {
    const matches = generateDoubleEliminationBracket(makeParticipants(8), {
      mergeRound: 3,
    });
    expect(matches).toHaveLength(14); // 2N - N/2^k - 1 = 16 - 1 - 1
    assertDoubleElimTopology(matches, 8, 3);
    // The losers bracket ends in a single final-major match (1 LB survivor).
    const lbRounds = matches.filter((m) => m.bracketType === 'losers');
    const lastLb = Math.max(...lbRounds.map((m) => m.round));
    expect(lbRounds.filter((m) => m.round === lastLb)).toHaveLength(1);
  });

  it('marks empty seats as walkovers and resolves them at gen time (byes)', () => {
    // 12 players in a 16-slot bracket => 4 walkover seats across R1 upper.
    const matches = generateDoubleEliminationBracket(makeParticipants(12));
    const r1 = matches.filter((m) => m.round === 1 && m.bracketType === 'winners');
    const walkoverSeats = r1.filter(
      (m) => m.player1IsWalkover === true || m.player2IsWalkover === true,
    );
    expect(walkoverSeats.length).toBeGreaterThan(0);
    const resolved = r1.find(
      (m) => m.isCompletedWalkover && m.walkoverWinnerId !== null,
    );
    expect(resolved).toBeDefined();
  });

  it('clears all deterministic pointers in random-advancement mode', () => {
    const matches = generateDoubleEliminationBracket(makeParticipants(16), {
      randomAdvancement: true,
      mergeRound: 3,
    });
    for (const m of matches) {
      expect(m.nextMatchId).toBeUndefined();
      expect(m.nextMatchPosition).toBeUndefined();
      expect(m.losersNextMatchPosition).toBeUndefined();
      expect(m.losersNextMatchSlot).toBeUndefined();
    }
  });
});

describe('generateRoundRobinMatches', () => {
  it('creates n*(n-1)/2 unique pairings for even n', () => {
    const matches = generateRoundRobinMatches(makeParticipants(4));
    expect(matches).toHaveLength(6);
    const pairs = matches.map((m) =>
      [m.player1Id, m.player2Id].sort().join('|'),
    );
    expect(new Set(pairs).size).toBe(6); // all distinct
  });

  it('creates n*(n-1)/2 pairings for odd n (bye handled)', () => {
    const matches = generateRoundRobinMatches(makeParticipants(5));
    expect(matches).toHaveLength(10);
    // No match should reference a missing/undefined player.
    for (const m of matches) {
      expect(m.player1Id).toBeTruthy();
      expect(m.player2Id).toBeTruthy();
    }
  });
});

describe('generateBracket (dispatcher)', () => {
  it('throws with fewer than 2 participants', () => {
    expect(() => generateBracket('single_elimination', makeParticipants(1))).toThrow();
  });

  it('dispatches to the round-robin generator', () => {
    const matches = generateBracket('round_robin', makeParticipants(4));
    expect(matches).toHaveLength(6);
  });

  it('threads randomAdvancement into single elimination (pointers cleared)', () => {
    const matches = generateBracket('single_elimination', makeParticipants(8), true);
    expect(matches).toHaveLength(7);
    for (const m of matches) {
      expect(m.nextMatchId).toBeUndefined();
    }
  });

  it('throws on an unknown format', () => {
    expect(() =>
      // @ts-expect-error intentionally invalid format
      generateBracket('unknown_format', makeParticipants(4)),
    ).toThrow();
  });
});

describe('getBracketStats', () => {
  it('single elimination: bracketSize-1 matches', () => {
    expect(getBracketStats('single_elimination', 8)).toEqual({
      totalMatches: 7,
      totalRounds: 3,
    });
  });

  it('double elimination: 2N - N/2^M - 1 matches, k+1 rounds', () => {
    // 10 players => bracket 16, mergeRound 2 (default) => historical 27 / 5.
    expect(getBracketStats('double_elimination', 10)).toEqual({
      totalMatches: 27,
      totalRounds: 5,
    });
    // full DE on 8 (mergeRound 3 = k): 14 matches, 4 rounds.
    expect(getBracketStats('double_elimination', 8, 3)).toEqual({
      totalMatches: 14,
      totalRounds: 4,
    });
    // full DE on 16 (mergeRound 4 = k): 30 matches, 5 rounds.
    expect(getBracketStats('double_elimination', 16, 4)).toEqual({
      totalMatches: 30,
      totalRounds: 5,
    });
  });

  it('round robin: n*(n-1)/2 matches', () => {
    expect(getBracketStats('round_robin', 6)).toEqual({
      totalMatches: 15,
      totalRounds: 5,
    });
  });
});

describe('getRoundName', () => {
  it('names round-robin rounds as tours', () => {
    expect(getRoundName(2, 0, 'round_robin')).toBe('Тур 2');
  });

  it('names double-elimination upper rounds (mergeRound 2)', () => {
    expect(getRoundName(1, 5, 'double_elimination')).toBe('1/8 финала');
    expect(getRoundName(2, 5, 'double_elimination')).toBe('1/4 финала');
    expect(getRoundName(3, 5, 'double_elimination')).toBe('Объединение');
    expect(getRoundName(4, 5, 'double_elimination')).toBe('Полуфинал');
    expect(getRoundName(5, 5, 'double_elimination')).toBe('Финал');
  });

  it('names the grand final for a full double elimination (mergeRound=k)', () => {
    // 16-player full DE: totalRounds = 5, mergeRound = 4 = k.
    expect(getRoundName(5, 5, 'double_elimination', 'winners', 4)).toBe(
      'Гранд-финал',
    );
  });

  it('names double-elimination lower rounds', () => {
    expect(getRoundName(1, 5, 'double_elimination', 'losers')).toBe(
      'Нижняя сетка, раунд 1',
    );
    expect(getRoundName(3, 5, 'double_elimination', 'losers')).toBe(
      'Нижняя сетка, раунд 3',
    );
  });

  it('names single-elimination rounds from the end', () => {
    expect(getRoundName(3, 3, 'single_elimination')).toBe('Финал');
    expect(getRoundName(2, 3, 'single_elimination')).toBe('Полуфинал');
    expect(getRoundName(1, 3, 'single_elimination')).toBe('Четвертьфинал');
  });

  it('names groups_playoff group rounds by group letter', () => {
    expect(getRoundName(2, 0, 'groups_playoff', 'winners', 2, 'group', 0)).toBe(
      'Группа A, тур 2',
    );
    expect(getRoundName(1, 0, 'groups_playoff', 'winners', 2, 'group', 1)).toBe(
      'Группа B, тур 1',
    );
  });

  it('names groups_playoff playoff rounds like single elimination', () => {
    expect(getRoundName(2, 2, 'groups_playoff', 'winners', 2, 'playoff')).toBe(
      'Финал',
    );
    expect(getRoundName(1, 2, 'groups_playoff', 'winners', 2, 'playoff')).toBe(
      'Полуфинал',
    );
  });
});

describe('assignParticipantsToGroups', () => {
  it('distributes 8 seeds into 2 groups by snake order', () => {
    const groups = assignParticipantsToGroups(makeParticipants(8), 2, 'snake');
    expect(groups).toHaveLength(2);
    // Snake: seeds 1,4,5,8 → group A; 2,3,6,7 → group B.
    expect(groups[0]?.map((p) => p.seed)).toEqual([1, 4, 5, 8]);
    expect(groups[1]?.map((p) => p.seed)).toEqual([2, 3, 6, 7]);
  });

  it('keeps balanced group sizes for a random draw', () => {
    const groups = assignParticipantsToGroups(makeParticipants(8), 4, 'random');
    expect(groups).toHaveLength(4);
    expect(groups.every((g) => g.length === 2)).toBe(true);
    // Every participant placed exactly once.
    expect(groups.flat()).toHaveLength(8);
  });
});

describe('generateGroupStageMatches', () => {
  it('builds a round-robin per group with phase/groupIndex tags', () => {
    const matches = generateGroupStageMatches(makeParticipants(8), 2, 4, 'snake');
    // 2 groups × C(4,2)=6 = 12 matches.
    expect(matches).toHaveLength(12);
    expect(matches.every((m) => m.phase === 'group')).toBe(true);
    expect(matches.filter((m) => m.groupIndex === 0)).toHaveLength(6);
    expect(matches.filter((m) => m.groupIndex === 1)).toHaveLength(6);
    // Positions are globally unique; no winner routing in the group phase.
    expect(new Set(matches.map((m) => m.position)).size).toBe(12);
    expect(matches.every((m) => m.nextMatchId === undefined)).toBe(true);
    // Full groups → no walkovers.
    expect(matches.some((m) => m.isCompletedWalkover)).toBe(false);
  });

  it('pads an under-filled group with walkovers', () => {
    // 11 players, 2 groups × 6 → snake split 5 + 6; the short group gets one
    // walkover slot. Each group still has C(6,2)=15 match rows.
    const matches = generateGroupStageMatches(makeParticipants(11), 2, 6, 'snake');
    expect(matches).toHaveLength(30);
    expect(matches.every((m) => m.phase === 'group')).toBe(true);

    const walkovers = matches.filter((m) => m.isCompletedWalkover);
    // The 5-player group: each real player gets one auto-win vs the walkover.
    expect(walkovers).toHaveLength(5);
    for (const w of walkovers) {
      // Exactly one side is the walkover, and the real player is the winner.
      const nullSides = [w.player1Id, w.player2Id].filter((p) => p === null);
      expect(nullSides).toHaveLength(1);
      expect(w.walkoverWinnerId).not.toBeNull();
    }
    // All walkovers sit in a single group.
    expect(new Set(walkovers.map((m) => m.groupIndex)).size).toBe(1);
  });

  it('handles odd full groups via a scheduling bye (no walkovers)', () => {
    // 10 players, 2 groups × 5 (odd, full) → C(5,2)=10 per group, no walkovers.
    const matches = generateGroupStageMatches(makeParticipants(10), 2, 5, 'snake');
    expect(matches).toHaveLength(20);
    expect(matches.some((m) => m.isCompletedWalkover)).toBe(false);
  });

  it('throws with fewer than 2 groups', () => {
    expect(() =>
      generateGroupStageMatches(makeParticipants(4), 1, 4, 'snake'),
    ).toThrow();
  });

  it('throws when participants exceed the group capacity', () => {
    expect(() =>
      generateGroupStageMatches(makeParticipants(13), 2, 6, 'snake'),
    ).toThrow();
  });
});

describe('generatePlayoffFromQualifiers', () => {
  it('produces a single-elimination bracket tagged as playoff', () => {
    const matches = generatePlayoffFromQualifiers(makeParticipants(4));
    expect(matches).toHaveLength(3); // SE of 4 → 3 matches
    expect(matches.every((m) => m.phase === 'playoff')).toBe(true);
  });

  it('handles a non-power-of-two qualifier count via byes', () => {
    const matches = generatePlayoffFromQualifiers(makeParticipants(6));
    // bracket of 8 → 7 match rows, two round-1 byes auto-completed.
    expect(matches).toHaveLength(7);
    const byes = matches.filter((m) => m.isCompletedWalkover);
    expect(byes.length).toBe(2);
  });
});

describe('getBracketStats (groups_playoff)', () => {
  it('sums group matches and the playoff bracket', () => {
    // 2 groups × 4, 2 qualify → 12 group matches + (4-player SE = 3) = 15.
    expect(
      getBracketStats('groups_playoff', 8, 2, {
        groupsCount: 2,
        participantsPerGroup: 4,
        qualifiersPerGroup: 2,
      }),
    ).toEqual({
      totalMatches: 15,
      // group rounds (4 players → 3) + playoff rounds (4 → 2) = 5.
      totalRounds: 5,
    });
  });
});

describe('generateBracket (groups_playoff dispatch)', () => {
  it('generates only the group phase from the group config', () => {
    const matches = generateBracket('groups_playoff', makeParticipants(8), false, 2, {
      groupsCount: 2,
      participantsPerGroup: 4,
      groupDraw: 'snake',
    });
    expect(matches).toHaveLength(12);
    expect(matches.every((m) => m.phase === 'group')).toBe(true);
  });

  it('throws without a group config', () => {
    expect(() =>
      generateBracket('groups_playoff', makeParticipants(8)),
    ).toThrow();
  });
});
