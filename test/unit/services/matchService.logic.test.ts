import { describe, expect, it } from 'vitest';

import type { UUID } from 'crypto';

import {
  busyPlayersMessage,
  deriveFrameResult,
  loserTarget,
  parseFrameScoreLine,
  pickNextReadyMatch,
  playerSlotName,
  validateCorrectionScores,
  winScoreForMatch,
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

describe('parseFrameScoreLine', () => {
  it('accepts dash, colon and space separators (with optional spacing)', () => {
    expect(parseFrameScoreLine('74-15')).toEqual({
      player1Points: 74,
      player2Points: 15,
    });
    expect(parseFrameScoreLine('74:15')).toEqual({
      player1Points: 74,
      player2Points: 15,
    });
    expect(parseFrameScoreLine('74 15')).toEqual({
      player1Points: 74,
      player2Points: 15,
    });
    expect(parseFrameScoreLine('74 - 15')).toEqual({
      player1Points: 74,
      player2Points: 15,
    });
    expect(parseFrameScoreLine('  74   15  ')).toEqual({
      player1Points: 74,
      player2Points: 15,
    });
  });

  it('returns the tie unchanged (caller rejects ties separately)', () => {
    expect(parseFrameScoreLine('50 50')).toEqual({
      player1Points: 50,
      player2Points: 50,
    });
  });

  it('returns null for malformed input', () => {
    expect(parseFrameScoreLine('7415')).toBeNull(); // no separator
    expect(parseFrameScoreLine('abc')).toBeNull();
    expect(parseFrameScoreLine('74-')).toBeNull();
    expect(parseFrameScoreLine('74 15 20')).toBeNull();
    expect(parseFrameScoreLine('')).toBeNull();
  });
});

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

describe('winScoreForMatch', () => {
  it('prefers the match-level length when one was materialized', () => {
    expect(winScoreForMatch({ winScore: 5 }, { winScore: 3 })).toBe(5);
  });

  it('falls back to the tournament for pre-M2-11 and non-playoff rows', () => {
    expect(winScoreForMatch({ winScore: null }, { winScore: 3 })).toBe(3);
  });
});

const P3 = '33333333-3333-3333-3333-333333333333' as UUID;
const P4 = '44444444-4444-4444-4444-444444444444' as UUID;

describe('playerSlotName', () => {
  it('prefers the full name', () => {
    expect(
      playerSlotName({ name: 'Иван', surname: 'Петров', username: 'vanya' }),
    ).toBe('Иван Петров');
  });

  it('falls back to the username, then to a generic label', () => {
    expect(playerSlotName({ name: null, username: 'vanya' })).toBe('vanya');
    expect(playerSlotName({})).toBe('Участник');
    expect(playerSlotName({ name: '  ', surname: null, username: null })).toBe(
      'Участник',
    );
  });

  it('truncates so two names still fit a Telegram callback answer', () => {
    const long = playerSlotName({ name: 'я'.repeat(50), surname: 'ю'.repeat(90) });
    expect(long).toHaveLength(40);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('busyPlayersMessage', () => {
  it('uses the singular form for one blocked player', () => {
    expect(busyPlayersMessage(['Иван Петров'])).toBe(
      'Игрок Иван Петров уже играет другой матч — сначала завершите его',
    );
  });

  it('uses the plural form when both players are blocked', () => {
    expect(busyPlayersMessage(['Иван', 'Пётр'])).toBe(
      'Игроки Иван и Пётр уже играют другие матчи — сначала завершите их',
    );
  });

  it('degrades to a generic name rather than printing undefined', () => {
    expect(busyPlayersMessage([])).toContain('Участник');
  });
});

describe('pickNextReadyMatch', () => {
  const m = (id: string, a: UUID | null, b: UUID | null) => ({
    id,
    player1Id: a,
    player2Id: b,
  });

  it('returns the first candidate when nobody is busy', () => {
    const picked = pickNextReadyMatch(
      [m('a', P1, P2), m('b', P3, P4)],
      new Set(),
    );
    expect(picked?.id).toBe('a');
  });

  it('skips a candidate whose player is mid-game', () => {
    const picked = pickNextReadyMatch(
      [m('a', P1, P2), m('b', P3, P4)],
      new Set([P1]),
    );
    expect(picked?.id).toBe('b');
  });

  it('blocks on either slot, not just player1', () => {
    const picked = pickNextReadyMatch(
      [m('a', P1, P2), m('b', P3, P4)],
      new Set([P2]),
    );
    expect(picked?.id).toBe('b');
  });

  it('skips half-filled bracket slots', () => {
    const picked = pickNextReadyMatch(
      [m('a', P1, null), m('b', null, P2), m('c', P3, P4)],
      new Set(),
    );
    expect(picked?.id).toBe('c');
  });

  it('returns null when every candidate is blocked', () => {
    expect(
      pickNextReadyMatch([m('a', P1, P2)], new Set([P1, P2])),
    ).toBeNull();
  });
});
