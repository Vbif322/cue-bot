import { describe, expect, it } from 'vitest';

import { formatPlayerName } from '@/bot/ui/matchUI.js';

describe('formatPlayerName', () => {
  it('renders a clickable profile link with full name when telegramId is known', () => {
    expect(
      formatPlayerName({
        username: 'ivan',
        name: 'Иван',
        surname: 'Петров',
        telegramId: '12345',
      }),
    ).toBe('[Иван Петров](tg://user?id=12345)');
  });

  it('uses the link text from username when no name is set', () => {
    expect(
      formatPlayerName({ username: 'ivan', telegramId: '12345' }),
    ).toBe('[ivan](tg://user?id=12345)');
  });

  it('falls back to a clickable @mention when telegramId is missing', () => {
    expect(formatPlayerName({ username: 'ivan' })).toBe('@ivan');
  });

  it('shows a non-clickable escaped name when only name is available', () => {
    expect(
      formatPlayerName({ username: null, name: 'Иван', surname: 'Петров' }),
    ).toBe('Иван Петров');
  });

  it('escapes Markdown syntax characters in the link text', () => {
    expect(
      formatPlayerName({ username: null, name: 'a_b', telegramId: '7' }),
    ).toBe('[a\\_b](tg://user?id=7)');
  });

  it('returns plain text (no link, no @) in markdown:false mode', () => {
    expect(
      formatPlayerName(
        { username: 'ivan', name: 'Иван', surname: 'Петров', telegramId: '1' },
        { markdown: false },
      ),
    ).toBe('Иван Петров');
  });

  it('suppresses the link when link:false', () => {
    expect(
      formatPlayerName(
        { username: 'ivan', name: 'Иван', telegramId: '1' },
        { link: false },
      ),
    ).toBe('Иван');
  });

  it('falls back to «Участник» when nothing is provided', () => {
    expect(formatPlayerName({ username: null })).toBe('Участник');
    expect(formatPlayerName(null)).toBe('Участник');
  });
});
