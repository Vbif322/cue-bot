import { describe, expect, it } from 'vitest';

import { loserTarget, validateCorrectionScores } from '@/services/matchService.js';

const asMatch = (
  fields: Partial<{
    round: number;
    position: number;
    bracketType: string;
    losersNextMatchPosition: number | null;
    losersNextMatchSlot: string | null;
  }>,
) =>
  ({
    round: 1,
    position: 1,
    bracketType: 'winners',
    losersNextMatchPosition: null,
    losersNextMatchSlot: null,
    ...fields,
  }) as unknown as Parameters<typeof loserTarget>[0];

describe('loserTarget (stored-pointer loser routing)', () => {
  it('reads the stored loser drop position + slot', () => {
    expect(
      loserTarget(
        asMatch({ losersNextMatchPosition: 9, losersNextMatchSlot: 'player1' }),
      ),
    ).toEqual({ position: 9, slot: 'player1Id' });
    expect(
      loserTarget(
        asMatch({ losersNextMatchPosition: 17, losersNextMatchSlot: 'player2' }),
      ),
    ).toEqual({ position: 17, slot: 'player2Id' });
  });

  it('returns null when no loser drop is stored (eliminated)', () => {
    expect(loserTarget(asMatch({ round: 3, position: 21 }))).toBeNull();
  });

  it('returns null for non-winners matches', () => {
    expect(
      loserTarget(
        asMatch({
          bracketType: 'losers',
          losersNextMatchPosition: 9,
          losersNextMatchSlot: 'player1',
        }),
      ),
    ).toBeNull();
  });

  it('falls back to the legacy 16-slot formula when slot is absent', () => {
    // Legacy rows: position stored, slot null. R1 odd -> player1, even -> player2.
    expect(
      loserTarget(asMatch({ round: 1, position: 1, losersNextMatchPosition: 9 })),
    ).toEqual({ position: 9, slot: 'player1Id' });
    expect(
      loserTarget(asMatch({ round: 1, position: 2, losersNextMatchPosition: 9 })),
    ).toEqual({ position: 9, slot: 'player2Id' });
    expect(
      loserTarget(
        asMatch({ round: 2, position: 13, losersNextMatchPosition: 17 }),
      ),
    ).toEqual({ position: 17, slot: 'player2Id' });
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
