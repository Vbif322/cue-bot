import { describe, expect, it } from 'vitest';

import {
  formatStageWinScores,
  validateGroupConfig,
  validateStageWinScores,
  winScoreForStageDistance,
} from '@/shared/tournament/tournamentOptions.js';

describe('validateGroupConfig', () => {
  it('accepts a valid configuration', () => {
    expect(
      validateGroupConfig({
        groupsCount: 4,
        participantsPerGroup: 4,
        qualifiersPerGroup: 2,
      }),
    ).toBeNull();
  });

  it('requires at least 2 groups', () => {
    expect(
      validateGroupConfig({
        groupsCount: 1,
        participantsPerGroup: 4,
        qualifiersPerGroup: 2,
      }),
    ).toMatch(/групп/i);
  });

  it('requires at least 2 participants per group', () => {
    expect(
      validateGroupConfig({
        groupsCount: 2,
        participantsPerGroup: 1,
        qualifiersPerGroup: 1,
      }),
    ).toMatch(/в группе/i);
  });

  it('rejects qualifiers >= participants per group', () => {
    expect(
      validateGroupConfig({
        groupsCount: 2,
        participantsPerGroup: 4,
        qualifiersPerGroup: 4,
      }),
    ).toMatch(/меньше/i);
  });

  it('requires a non-zero qualifier count', () => {
    expect(
      validateGroupConfig({
        groupsCount: 2,
        participantsPerGroup: 4,
        qualifiersPerGroup: 0,
      }),
    ).toMatch(/хотя бы 1/i);
  });
});

describe('validateStageWinScores', () => {
  it('treats null/undefined/empty as "no overrides"', () => {
    expect(validateStageWinScores(null)).toBeNull();
    expect(validateStageWinScores(undefined)).toBeNull();
    expect(validateStageWinScores({})).toBeNull();
  });

  it('accepts a valid per-stage map', () => {
    expect(validateStageWinScores({ final: 5, semifinal: 4 })).toBeNull();
  });

  it('rejects an unknown stage', () => {
    expect(validateStageWinScores({ round_of_64: 3 })).toMatch(/стадия/i);
  });

  it('rejects a win score outside the allowed set', () => {
    expect(validateStageWinScores({ final: 9 })).toMatch(/Финал/);
  });

  it('rejects a non-object', () => {
    expect(validateStageWinScores([])).toMatch(/Некорректная/i);
    expect(validateStageWinScores(7)).toMatch(/Некорректная/i);
  });
});

describe('winScoreForStageDistance', () => {
  it('maps distance 0/1/2 onto final/semifinal/quarterfinal', () => {
    const cfg = { final: 5, semifinal: 4, quarterfinal: 3 } as const;
    expect(winScoreForStageDistance(0, 2, cfg)).toBe(5);
    expect(winScoreForStageDistance(1, 2, cfg)).toBe(4);
    expect(winScoreForStageDistance(2, 2, cfg)).toBe(3);
  });

  it('falls back to the tournament value for earlier rounds', () => {
    expect(winScoreForStageDistance(3, 2, { final: 5 })).toBe(2);
  });

  it('falls back for a stage without an override', () => {
    expect(winScoreForStageDistance(1, 2, { final: 5 })).toBe(2);
    expect(winScoreForStageDistance(0, 2, null)).toBe(2);
  });
});

describe('formatStageWinScores', () => {
  it('lists overrides from the final outwards', () => {
    expect(formatStageWinScores({ semifinal: 4, final: 5 })).toBe(
      'Финал — до 5, Полуфинал — до 4',
    );
  });

  it('returns null when nothing is overridden', () => {
    expect(formatStageWinScores(null)).toBeNull();
    expect(formatStageWinScores({})).toBeNull();
  });
});
