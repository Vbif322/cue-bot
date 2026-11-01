import { InlineKeyboard } from 'grammy';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  addRefereeWebAppButton,
  refereeMatchPath,
  refereeWebAppUrl,
} from '@/bot/ui/refereeUI.js';
import { getNoShowAlertKeyboard } from '@/bot/ui/matchUI.js';
import type { MatchWithPlayers } from '@/bot/@types/match.js';

const webAppUrls = (kb: InlineKeyboard) =>
  kb.inline_keyboard
    .flat()
    .flatMap((b) => ('web_app' in b ? [b.web_app.url] : []));

describe('refereeWebAppUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds the URL from an https PUBLIC_BASE_URL', () => {
    vi.stubEnv('PUBLIC_BASE_URL', 'https://cue.example');
    expect(refereeWebAppUrl()).toBe('https://cue.example/referee');
    expect(refereeWebAppUrl(refereeMatchPath('m1'))).toBe(
      'https://cue.example/referee/m/m1',
    );
  });

  it('drops a trailing slash and adds a missing leading one', () => {
    vi.stubEnv('PUBLIC_BASE_URL', 'https://cue.example/');
    expect(refereeWebAppUrl('referee')).toBe('https://cue.example/referee');
  });

  it('is null without a base URL or with plain http', () => {
    vi.stubEnv('PUBLIC_BASE_URL', '');
    expect(refereeWebAppUrl()).toBeNull();
    vi.stubEnv('PUBLIC_BASE_URL', 'http://localhost:5174');
    expect(refereeWebAppUrl()).toBeNull();
  });
});

describe('addRefereeWebAppButton', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('adds a web_app button', () => {
    vi.stubEnv('PUBLIC_BASE_URL', 'https://cue.example');
    const kb = addRefereeWebAppButton(new InlineKeyboard(), '/referee');
    expect(webAppUrls(kb)).toEqual(['https://cue.example/referee']);
  });

  it('is a no-op without a usable base URL', () => {
    vi.stubEnv('PUBLIC_BASE_URL', '');
    const kb = addRefereeWebAppButton(new InlineKeyboard());
    expect(kb.inline_keyboard.flat()).toHaveLength(0);
  });
});

describe('getNoShowAlertKeyboard', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const match = {
    id: 'm1',
    tournamentId: 't1',
    player1Id: 'p1',
    player2Id: 'p2',
    player1ReadyAt: null,
    player2ReadyAt: null,
    player1Username: 'one',
    player2Username: 'two',
  } as unknown as MatchWithPlayers;

  it('links the referee page of the match', () => {
    vi.stubEnv('PUBLIC_BASE_URL', 'https://cue.example');
    expect(webAppUrls(getNoShowAlertKeyboard(match))).toEqual([
      'https://cue.example/referee/m/m1',
    ]);
  });

  it('has no web_app button without a base URL', () => {
    vi.stubEnv('PUBLIC_BASE_URL', '');
    expect(webAppUrls(getNoShowAlertKeyboard(match))).toEqual([]);
  });
});
