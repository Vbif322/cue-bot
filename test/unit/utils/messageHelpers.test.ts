import { describe, expect, it } from 'vitest';

import { escapeMarkdown } from '@/utils/messageHelpers.js';

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
