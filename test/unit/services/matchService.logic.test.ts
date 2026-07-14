import { describe, expect, it } from 'vitest';

import type { UUID } from 'crypto';

import {
  deriveFrameResult,
  loserTarget,
  validateCorrectionScores,
  type FrameInput,
} from '@/services/matchService.js';

const P1 = '11111111-1111-1111-1111-111111111111' as UUID;
const P2 = '22222222-2222-2222-2222-222222222222' as UUID;
const frame = (a: number, b: number): FrameInput => ({
  player1Points: a,
  player2Points: b,
});

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
        asMatch({
          losersNextMatchPosition: 17,
          losersNextMatchSlot: 'player2',
        }),
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
      loserTarget(
        asMatch({ round: 1, position: 1, losersNextMatchPosition: 9 }),
      ),
    ).toEqual({ position: 9, slot: 'player1Id' });
    expect(
      loserTarget(
        asMatch({ round: 1, position: 2, losersNextMatchPosition: 9 }),
      ),
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

describe('deriveFrameResult (snooker frame → winner/aggregate)', () => {
  it('tallies frames and picks the leader as winner', () => {
    const frames = [frame(74, 12), frame(8, 66), frame(90, 1), frame(55, 40)];
    expect(deriveFrameResult(frames, 3, P1, P2)).toEqual({
      winnerId: P1,
      player1Score: 3,
      player2Score: 1,
    });
  });

  it('honours player orientation (player2 wins)', () => {
    const frames = [frame(10, 60), frame(70, 4), frame(2, 80), frame(9, 55)];
    expect(deriveFrameResult(frames, 3, P1, P2)).toEqual({
      winnerId: P2,
      player1Score: 1,
      player2Score: 3,
    });
  });

  it('accepts the exact-winScore boundary (3:0 sweep)', () => {
    const frames = [frame(80, 1), frame(70, 20), frame(65, 30)];
    expect(deriveFrameResult(frames, 3, P1, P2)).toEqual({
      winnerId: P1,
      player1Score: 3,
      player2Score: 0,
    });
  });

  it('rejects an empty frame list', () => {
    expect(deriveFrameResult([], 3, P1, P2)).toEqual({
      error: 'Нужно ввести хотя бы один фрейм',
    });
  });

  it('rejects a tied frame', () => {
    const frames = [frame(50, 50), frame(80, 1)];
    expect(deriveFrameResult(frames, 3, P1, P2)).toEqual({
      error: 'Фрейм 1: ничья недопустима',
    });
  });

  it('rejects when nobody reaches winScore (too few frames)', () => {
    const frames = [frame(74, 12), frame(8, 66)];
    expect(deriveFrameResult(frames, 3, P1, P2)).toEqual({
      error: 'Один из игроков должен выиграть 3 фреймов',
    });
  });

  it('rejects when the leader exceeds winScore (too many frames)', () => {
    const frames = [frame(80, 1), frame(70, 2), frame(60, 3), frame(50, 4)];
    expect(deriveFrameResult(frames, 3, P1, P2)).toEqual({
      error: 'Один из игроков должен выиграть 3 фреймов',
    });
  });

  it('passes breaks through untouched by winner derivation', () => {
    const frames: FrameInput[] = [
      { player1Points: 80, player2Points: 1, player1Break: 80 },
      { player1Points: 70, player2Points: 20, player1Break: 54 },
    ];
    // race-to-2: 2:0, breaks do not affect the aggregate/winner
    expect(deriveFrameResult(frames, 2, P1, P2)).toEqual({
      winnerId: P1,
      player1Score: 2,
      player2Score: 0,
    });
  });
});
