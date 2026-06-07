import { describe, expect, it } from 'vitest';

import { escapeMarkdown, formatFullName } from '@/utils/messageHelpers.js';

describe('escapeMarkdown (Telegram legacy Markdown)', () => {
  it('escapes the four syntax tokens _ * ` [', () => {
    expect(escapeMarkdown('a_b*c`d[e')).toBe('a\\_b\\*c\\`d\\[e');
  });

  it('leaves non-syntax characters untouched', () => {
    expect(escapeMarkdown('plain (text) ] ~ #')).toBe('plain (text) ] ~ #');
  });

  it('returns an empty string unchanged', () => {
    expect(escapeMarkdown('')).toBe('');
  });
});

describe('formatFullName', () => {
  it('joins name and surname', () => {
    expect(formatFullName('Иван', 'Петров')).toBe('Иван Петров');
  });

  it('uses only the present part', () => {
    expect(formatFullName('Иван', null)).toBe('Иван');
    expect(formatFullName(null, 'Петров')).toBe('Петров');
  });

  it('trims surrounding whitespace', () => {
    expect(formatFullName('  Иван ', ' Петров ')).toBe('Иван Петров');
  });

  it('returns null when both are empty or blank', () => {
    expect(formatFullName(null, undefined)).toBeNull();
    expect(formatFullName('   ', '')).toBeNull();
  });
});
