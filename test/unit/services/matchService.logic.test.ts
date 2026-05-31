import { describe, expect, it } from 'vitest';

import { loserTarget, validateCorrectionScores } from '@/services/matchService.js';

const asMatch = (round: number, position: number, bracketType: string) =>
  ({ round, position, bracketType }) as unknown as Parameters<
    typeof loserTarget
  >[0];

describe('loserTarget (16-player double-elimination loser routing)', () => {
  it('routes R1 winners-bracket losers into R1 lower (pos 9-12)', () => {
    expect(loserTarget(asMatch(1, 1, 'winners'))).toEqual({
      position: 9,
      slot: 'player1Id',
    });
    expect(loserTarget(asMatch(1, 2, 'winners'))).toEqual({
      position: 9,
      slot: 'player2Id',
    });
    expect(loserTarget(asMatch(1, 3, 'winners'))).toEqual({
      position: 10,
      slot: 'player1Id',
    });
    expect(loserTarget(asMatch(1, 8, 'winners'))).toEqual({
      position: 12,
      slot: 'player2Id',
    });
  });

  it('routes R2 winners-bracket losers into R2 lower (pos 17-20) as player2', () => {
    expect(loserTarget(asMatch(2, 13, 'winners'))).toEqual({
      position: 17,
      slot: 'player2Id',
    });
    expect(loserTarget(asMatch(2, 16, 'winners'))).toEqual({
      position: 20,
      slot: 'player2Id',
    });
  });

  it('returns null for rounds beyond 2 (loser eliminated)', () => {
    expect(loserTarget(asMatch(3, 21, 'winners'))).toBeNull();
  });

  it('returns null for non-winners matches', () => {
    expect(loserTarget(asMatch(1, 9, 'losers'))).toBeNull();
  });
});

describe('validateCorrectionScores', () => {
  it('accepts a score where exactly one player reaches winScore', () => {
    expect(validateCorrectionScores(3, 1, 3)).toBeNull();
    expect(validateCorrectionScores(0, 3, 3)).toBeNull();
  });

  it('rejects when neither player reaches winScore', () => {
    expect(validateCorrectionScores(2, 1, 3)).toBe(
      'Один из игроков должен набрать 3 побед',
    );
  });

  it('rejects when both players reach winScore', () => {
    expect(validateCorrectionScores(3, 3, 3)).toBe(
      'Оба игрока не могут выиграть',
    );
  });
});
