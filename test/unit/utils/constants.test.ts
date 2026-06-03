import { describe, expect, it } from 'vitest';

import {
  formatDiscipline,
  formatFormat,
  formatScheduleMode,
  formatStatus,
  formatVisibility,
} from '@/utils/constants.js';

describe('constants formatters', () => {
  it('formatDiscipline maps known disciplines and falls back to input', () => {
    expect(formatDiscipline('snooker')).toBe('Снукер');
    expect(formatDiscipline('unknown')).toBe('unknown');
  });

  it('formatFormat maps known formats and falls back to input', () => {
    expect(formatFormat('single_elimination')).toBe('Олимпийская система');
    expect(formatFormat('double_elimination_random')).toBe(
      'Двойная элиминация (рандом)',
    );
    expect(formatFormat('mystery')).toBe('mystery');
  });

  it('formatStatus maps known statuses and falls back to input', () => {
    expect(formatStatus('draft')).toBe('Черновик');
    expect(formatStatus('in_progress')).toBe('В процессе');
    expect(formatStatus('???')).toBe('???');
  });

  it('formatVisibility maps known visibilities and falls back to input', () => {
    expect(formatVisibility('public')).toBe('Открытый');
    expect(formatVisibility('private')).toBe('Закрытый');
    expect(formatVisibility('???')).toBe('???');
  });

  it('formatScheduleMode maps known modes and falls back to input', () => {
    expect(formatScheduleMode('single_day')).toBe('Один день');
    expect(formatScheduleMode('per_match')).toBe('По матчам');
    expect(formatScheduleMode('???')).toBe('???');
  });
});
