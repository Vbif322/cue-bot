import { describe, expect, it } from 'vitest';

import { formatSignedDiff, formatStats } from '@/bot/ui/profileUI.js';
import type { UserMatchStats } from '@/services/userStatsService.js';

const base: UserMatchStats = {
  played: 3,
  wins: 2,
  losses: 1,
  framesWon: 0,
  framesLost: 0,
  points: null,
  maxBreak: null,
};

describe('formatSignedDiff', () => {
  it('signs positive and negative values, leaves zero bare', () => {
    expect(formatSignedDiff(9)).toBe('+9');
    expect(formatSignedDiff(-3)).toBe('−3');
    expect(formatSignedDiff(0)).toBe('0');
  });
});

describe('formatStats', () => {
  it('shows a placeholder when no matches were played', () => {
    expect(formatStats({ ...base, played: 0, wins: 0, losses: 0 })).toBe(
      '📊 *Статистика*\nЕщё не сыграно ни одного матча.',
    );
  });

  it('omits frames, points and break lines without data', () => {
    const text = formatStats(base);
    expect(text).toContain('Win-rate: 67%');
    expect(text).not.toContain('Фреймы');
    expect(text).not.toContain('Очки');
    expect(text).not.toContain('Макс. брейк');
  });

  it('adds frames, points and max break when present', () => {
    const text = formatStats({
      ...base,
      framesWon: 7,
      framesLost: 4,
      points: { won: 300, lost: 410 },
      maxBreak: 57,
    });
    expect(text).toContain('Фреймы: 7–4 (+3)');
    expect(text).toContain('Очки: 300–410 (−110)');
    expect(text).toContain('Макс. брейк: 57');
  });

  it('shows frames without points for aggregate-only matches', () => {
    const text = formatStats({ ...base, framesWon: 6, framesLost: 6 });
    expect(text).toContain('Фреймы: 6–6 (0)');
    expect(text).not.toContain('Очки');
  });
});
