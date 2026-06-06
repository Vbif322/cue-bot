import { describe, expect, it } from 'vitest';

import { getRandomTargetPool } from '@/services/randomBracketAdvancement.js';

const match = (bracketType: string | null, round: number) => ({
  bracketType,
  round,
});

describe('getRandomTargetPool (double_elimination_random transitions)', () => {
  describe('winners bracket', () => {
    it.each([1, 2, 3, 4])('winner of winners R%i advances to R+1', (r) => {
      expect(getRandomTargetPool(match('winners', r), true)).toEqual({
        bracketType: 'winners',
        round: r + 1,
      });
    });

    it('winner of winners R5 is champion (null)', () => {
      expect(getRandomTargetPool(match('winners', 5), true)).toBeNull();
    });

    it('loser of winners R1 drops to losers R1', () => {
      expect(getRandomTargetPool(match('winners', 1), false)).toEqual({
        bracketType: 'losers',
        round: 1,
      });
    });

    it('loser of winners R2 drops to losers R2', () => {
      expect(getRandomTargetPool(match('winners', 2), false)).toEqual({
        bracketType: 'losers',
        round: 2,
      });
    });

    it.each([3, 4, 5])('loser of winners R%i is eliminated (null)', (r) => {
      expect(getRandomTargetPool(match('winners', r), false)).toBeNull();
    });
  });

  describe('losers bracket', () => {
    it('winner of losers R1 advances to losers R2', () => {
      expect(getRandomTargetPool(match('losers', 1), true)).toEqual({
        bracketType: 'losers',
        round: 2,
      });
    });

    it('winner of losers R2 merges into winners R3', () => {
      expect(getRandomTargetPool(match('losers', 2), true)).toEqual({
        bracketType: 'winners',
        round: 3,
      });
    });

    it.each([3, 4])('winner of losers R%i is eliminated (null)', (r) => {
      expect(getRandomTargetPool(match('losers', r), true)).toBeNull();
    });

    it.each([1, 2, 3])('loser of losers R%i is eliminated (null)', (r) => {
      expect(getRandomTargetPool(match('losers', r), false)).toBeNull();
    });
  });

  it('returns null for unknown bracket types', () => {
    expect(getRandomTargetPool(match('grand_final', 1), true)).toBeNull();
    expect(getRandomTargetPool(match(null, 1), true)).toBeNull();
  });
});
