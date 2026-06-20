import { InlineKeyboard } from 'grammy';
import { describe, expect, it } from 'vitest';

import { getMatchNotificationKeyboard } from '@/bot/ui/matchUI.js';
import type { MatchWithPlayers } from '@/bot/@types/match.js';

const callbacks = (kb: InlineKeyboard) =>
  kb.inline_keyboard
    .flat()
    .map((b) => ('callback_data' in b ? b.callback_data : undefined));

const match = {
  id: 'm1',
  tournamentId: 't1',
  player1Id: 'p1',
  player2Id: 'p2',
} as unknown as MatchWithPlayers;

describe('getMatchNotificationKeyboard', () => {
  it('always offers the навигационные кнопки matching the handlers', () => {
    const cb = callbacks(getMatchNotificationKeyboard(match));
    expect(cb).toContain('match:view:m1');
    expect(cb).toContain('bracket:view:t1');
  });

  it('without an action: no start/report button', () => {
    const cb = callbacks(getMatchNotificationKeyboard(match));
    expect(cb).not.toContain('match:start:m1');
    expect(cb).not.toContain('match:report:m1');
  });

  it("action 'start': emits match:start matching the handler regex", () => {
    const cb = callbacks(getMatchNotificationKeyboard(match, { action: 'start' }));
    expect(cb).toContain('match:start:m1');
    expect(cb).not.toContain('match:report:m1');
  });

  it("action 'report': emits match:report matching the handler regex", () => {
    const cb = callbacks(getMatchNotificationKeyboard(match, { action: 'report' }));
    expect(cb).toContain('match:report:m1');
    expect(cb).not.toContain('match:start:m1');
  });
});
