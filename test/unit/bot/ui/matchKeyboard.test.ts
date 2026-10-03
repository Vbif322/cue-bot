import { InlineKeyboard } from 'grammy';
import { describe, expect, it } from 'vitest';

import { getMatchKeyboard } from '@/bot/ui/matchUI.js';
import type { MatchWithPlayers } from '@/bot/@types/match.js';
import type { tournaments } from '@/db/schema.js';

type TournamentRow = typeof tournaments.$inferSelect;

const callbacks = (kb: InlineKeyboard) =>
  kb.inline_keyboard
    .flat()
    .map((b) => ('callback_data' in b ? b.callback_data : undefined));

const match = {
  id: 'm1',
  tournamentId: 't1',
  status: 'scheduled',
  round: 1,
  position: 1,
  player1Id: 'p1',
  player2Id: 'p2',
  bracketType: 'winners',
  scheduledAt: null,
  tableId: null,
  calledAt: null,
  callDeadlineAt: null,
  player1ReadyAt: null,
  player2ReadyAt: null,
} as unknown as MatchWithPlayers;

const tournament = (scheduleMode: 'single_day' | 'per_match') =>
  ({
    id: 't1',
    format: 'single_elimination',
    maxParticipants: 8,
    confirmedParticipants: 8,
    scheduleMode,
  }) as unknown as TournamentRow;

describe('getMatchKeyboard scheduling buttons', () => {
  it('per_match + canManage: emits msch:set matching the handler', () => {
    const kb = getMatchKeyboard(match, 'admin', tournament('per_match'), true);
    expect(callbacks(kb)).toContain('msch:set:m1');
  });

  it('per_match but not a manager: no scheduling button', () => {
    const kb = getMatchKeyboard(match, 'p1', tournament('per_match'), false);
    expect(callbacks(kb)).not.toContain('msch:set:m1');
  });

  it('single_day: no scheduling button even for a manager', () => {
    const kb = getMatchKeyboard(match, 'admin', tournament('single_day'), true);
    expect(callbacks(kb)).not.toContain('msch:set:m1');
  });

  it('per_match with a scheduled time: offers msch:clear', () => {
    const scheduled = {
      ...match,
      scheduledAt: new Date('2026-06-21T18:30:00Z'),
    } as unknown as MatchWithPlayers;
    const kb = getMatchKeyboard(scheduled, 'admin', tournament('per_match'), true);
    expect(callbacks(kb)).toContain('msch:clear:m1');
  });
});

describe('getMatchKeyboard start button', () => {
  it('per_match: a player may start their own match', () => {
    const kb = getMatchKeyboard(match, 'p1', tournament('per_match'), false);
    expect(callbacks(kb)).toContain('match:start:m1');
  });

  it('single_day: a player cannot jump the table queue', () => {
    const kb = getMatchKeyboard(match, 'p1', tournament('single_day'), false);
    expect(callbacks(kb)).not.toContain('match:start:m1');
  });

  it('single_day: a manager can still start it by hand', () => {
    const kb = getMatchKeyboard(match, 'admin', tournament('single_day'), true);
    expect(callbacks(kb)).toContain('match:start:m1');
  });
});

describe('getMatchKeyboard called to the table', () => {
  const called = {
    ...match,
    tableId: 'tb1',
    calledAt: new Date('2026-10-03T12:00:00Z'),
    callDeadlineAt: new Date('2026-10-03T12:10:00Z'),
    player1ReadyAt: new Date('2026-10-03T12:02:00Z'),
  } as unknown as MatchWithPlayers;

  it('offers «Я у стола» only to the player who has not confirmed', () => {
    const waiting = getMatchKeyboard(called, 'p2', tournament('single_day'), false);
    expect(callbacks(waiting)).toContain('match:ready:m1');

    const ready = getMatchKeyboard(called, 'p1', tournament('single_day'), false);
    expect(callbacks(ready)).not.toContain('match:ready:m1');
  });

  it('gives the manager postpone / extend, not the players', () => {
    const manager = getMatchKeyboard(called, 'admin', tournament('single_day'), true);
    expect(callbacks(manager)).toEqual(
      expect.arrayContaining(['match:postpone:m1', 'match:extend:m1']),
    );

    const player = getMatchKeyboard(called, 'p2', tournament('single_day'), false);
    expect(callbacks(player)).not.toContain('match:postpone:m1');
  });

  it('a seated match without a call (admin reservation) has no ready button', () => {
    const reserved = { ...match, tableId: 'tb1' } as unknown as MatchWithPlayers;
    const kb = getMatchKeyboard(reserved, 'p1', tournament('single_day'), false);
    expect(callbacks(kb)).not.toContain('match:ready:m1');
  });
});
