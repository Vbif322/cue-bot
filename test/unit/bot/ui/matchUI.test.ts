import { describe, expect, it } from 'vitest';

import { formatMatchCard, formatPlayerName } from '@/bot/ui/matchUI.js';
import type { MatchFrame } from '@/services/matchService.js';
import type { MatchWithPlayers } from '@/bot/@types/match.js';
import type { Tournament } from '@/bot/@types/tournament.js';

const tournament = {
  id: 't1',
  name: 'Snooker Cup',
  discipline: 'snooker_15_red',
  format: 'single_elimination',
  confirmedParticipants: 2,
  maxParticipants: 2,
  mergeRound: 2,
  winScore: 3,
  groupsCount: null,
  qualifiersPerGroup: null,
} as unknown as Tournament;

const pendingMatch = {
  position: 1,
  round: 1,
  bracketType: 'winners',
  phase: 'playoff',
  groupIndex: null,
  status: 'pending_confirmation',
  player1Score: 3,
  player2Score: 1,
  winnerId: null,
  player1Username: null,
  player1Name: 'Иван',
  player1Surname: null,
  player1TelegramId: null,
  player2Username: null,
  player2Name: 'Пётр',
  player2Surname: null,
  player2TelegramId: null,
  scheduledAt: null,
  isTechnicalResult: false,
} as unknown as MatchWithPlayers;

const frame = (
  a: number,
  b: number,
  aBreak: number | null = null,
): MatchFrame =>
  ({
    player1Points: a,
    player2Points: b,
    player1Break: aBreak,
    player2Break: null,
  }) as unknown as MatchFrame;

describe('formatMatchCard frame breakdown', () => {
  it('shows only the aggregate score when no frames are passed', () => {
    const text = formatMatchCard(pendingMatch, tournament);
    expect(text).toContain('Счёт: 3 : 1');
    expect(text).not.toContain('По кадрам');
    expect(text).not.toContain('Макс. брейк');
  });

  it('renders the per-frame breakdown when frames are present', () => {
    const text = formatMatchCard(pendingMatch, tournament, [
      frame(74, 12),
      frame(8, 66),
      frame(90, 5),
      frame(55, 40),
    ]);
    expect(text).toContain('По кадрам: 74:12, 8:66, 90:5, 55:40');
  });

  it('renders the max break line when a break is recorded', () => {
    const text = formatMatchCard(pendingMatch, tournament, [
      frame(80, 1, 80),
      frame(70, 20, 54),
      frame(60, 30),
    ]);
    expect(text).toContain('Макс. брейк');
    expect(text).toContain('80');
  });
});

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

  it('prefers a preview-free deep link for a real public username', () => {
    expect(
      formatPlayerName({
        username: 'ivanpetrov',
        name: 'Иван',
        surname: 'Петров',
        telegramId: '12345',
      }),
    ).toBe('[Иван Петров](tg://resolve?domain=ivanpetrov)');
  });

  it('uses the public username as link text when no name is set', () => {
    expect(
      formatPlayerName({ username: 'ivanpetrov', telegramId: '12345' }),
    ).toBe('[ivanpetrov](tg://resolve?domain=ivanpetrov)');
  });

  it('ignores the synthetic user_<id> handle and keeps the tg://user link', () => {
    expect(
      formatPlayerName({
        username: 'user_12345',
        name: 'Иван',
        telegramId: '12345',
      }),
    ).toBe('[Иван](tg://user?id=12345)');
  });

  it('ignores a non-handle username (e.g. Cyrillic) and keeps the tg://user link', () => {
    expect(
      formatPlayerName({
        username: 'Иван',
        name: 'Иван',
        surname: 'Петров',
        telegramId: '12345',
      }),
    ).toBe('[Иван Петров](tg://user?id=12345)');
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
