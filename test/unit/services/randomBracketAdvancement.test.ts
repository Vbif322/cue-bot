import { describe, expect, it } from 'vitest';

import { getRandomTargetPool } from '@/services/randomBracketAdvancement.js';

// Default dims: merge round 2, bracket size 16 (k=4) — the historical layout.
const pool = (
  bracketType: string | null,
  round: number,
  isWinner: boolean,
  mergeRound = 2,
  bracketSize = 16,
) => getRandomTargetPool({ bracketType, round }, isWinner, mergeRound, bracketSize);

describe('getRandomTargetPool (M=2, N=16 — historical layout)', () => {
  describe('winners bracket', () => {
    it.each([1, 2, 3, 4])('winner of winners R%i advances to R+1', (r) => {
      expect(pool('winners', r, true)).toEqual({
        bracketType: 'winners',
        round: r + 1,
      });
    });

    it('winner of winners R5 is champion (null)', () => {
      expect(pool('winners', 5, true)).toBeNull();
    });

    it('loser of winners R1 drops to losers R1', () => {
      expect(pool('winners', 1, false)).toEqual({
        bracketType: 'losers',
        round: 1,
      });
    });

    it('loser of winners R2 drops to losers R2', () => {
      expect(pool('winners', 2, false)).toEqual({
        bracketType: 'losers',
        round: 2,
      });
    });

    it.each([3, 4, 5])('loser of winners R%i is eliminated (null)', (r) => {
      expect(pool('winners', r, false)).toBeNull();
    });
  });

  describe('losers bracket', () => {
    it('winner of losers R1 advances to losers R2', () => {
      expect(pool('losers', 1, true)).toEqual({
        bracketType: 'losers',
        round: 2,
      });
    });

    it('winner of losers R2 merges into winners R3', () => {
      expect(pool('losers', 2, true)).toEqual({
        bracketType: 'winners',
        round: 3,
      });
    });

    it.each([3, 4])('winner of losers R%i is eliminated (null)', (r) => {
      expect(pool('losers', r, true)).toBeNull();
    });

    it.each([1, 2, 3])('loser of losers R%i is eliminated (null)', (r) => {
      expect(pool('losers', r, false)).toBeNull();
    });
  });

  it('returns null for unknown bracket types', () => {
    expect(pool('grand_final', 1, true)).toBeNull();
    expect(pool(null, 1, true)).toBeNull();
  });
});

describe('getRandomTargetPool (generalized merge rounds)', () => {
  it('full DE on 8 players (M=3, N=8): LB has 4 rounds, merges into round 4', () => {
    // k = 3, lastLb = 2*(3-1) = 4, merge round = 4.
    expect(pool('winners', 1, true, 3, 8)).toEqual({
      bracketType: 'winners',
      round: 2,
    });
    expect(pool('winners', 3, true, 3, 8)).toEqual({
      bracketType: 'winners',
      round: 4,
    });
    expect(pool('winners', 4, true, 3, 8)).toBeNull(); // champion (k+1 = 4)
    // upper round 3 loser drops to LB major round 2*(3-1)=4
    expect(pool('winners', 3, false, 3, 8)).toEqual({
      bracketType: 'losers',
      round: 4,
    });
    // LB internal advance and final-major merge
    expect(pool('losers', 3, true, 3, 8)).toEqual({
      bracketType: 'losers',
      round: 4,
    });
    expect(pool('losers', 4, true, 3, 8)).toEqual({
      bracketType: 'winners',
      round: 4,
    });
  });

  it('M=2 on 32 players (N=32, k=5): merge round is 3, final winners round is 6', () => {
    expect(pool('winners', 5, true, 2, 32)).toEqual({
      bracketType: 'winners',
      round: 6,
    });
    expect(pool('winners', 6, true, 2, 32)).toBeNull();
    expect(pool('losers', 2, true, 2, 32)).toEqual({
      bracketType: 'winners',
      round: 3,
    });
  });
});
