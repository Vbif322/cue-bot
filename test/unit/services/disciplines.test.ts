import { describe, expect, it } from 'vitest';

import {
  sports,
  disciplines,
  SPORT_DISCIPLINES,
  sportOfDiscipline,
  validateSportDiscipline,
  DEFAULT_WIN_SCORE_BY_DISCIPLINE,
} from '@/shared/tournament/disciplines.js';
import { winScores } from '@/shared/tournament/tournamentOptions.js';

describe('sport → discipline model', () => {
  it('SPORT_DISCIPLINES partitions the flat discipline set exactly', () => {
    const mapped = sports.flatMap((s) => SPORT_DISCIPLINES[s]);
    // Every discipline belongs to exactly one sport, none is orphaned.
    expect([...mapped].sort()).toEqual([...disciplines].sort());
    expect(new Set(mapped).size).toBe(mapped.length);
  });

  it('sportOfDiscipline inverts SPORT_DISCIPLINES', () => {
    for (const sport of sports) {
      for (const discipline of SPORT_DISCIPLINES[sport]) {
        expect(sportOfDiscipline(discipline)).toBe(sport);
      }
    }
  });

  it('validateSportDiscipline accepts matching pairs and rejects cross-sport ones', () => {
    expect(validateSportDiscipline('snooker', 'snooker_10_red')).toBeNull();
    expect(validateSportDiscipline('pool', 'pool_9')).toBeNull();
    expect(validateSportDiscipline('snooker', 'pool_8')).toBe(
      'Дисциплина не относится к выбранному виду бильярда',
    );
    expect(
      validateSportDiscipline('russian_billiards', 'snooker_15_red'),
    ).not.toBeNull();
  });

  it('every discipline has a default winScore from the allowed set', () => {
    for (const discipline of disciplines) {
      expect(winScores).toContain(DEFAULT_WIN_SCORE_BY_DISCIPLINE[discipline]);
    }
  });
});
