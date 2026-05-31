import { describe, expect, it } from 'vitest';

import {
  formatDiscipline,
  formatFormat,
  formatStatus,
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
});
