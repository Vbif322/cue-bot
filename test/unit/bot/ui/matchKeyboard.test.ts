import { describe, expect, it } from 'vitest';

import { getMatchKeyboard } from '@/bot/ui/matchUI.js';
import type { MatchWithPlayers } from '@/bot/@types/match.js';
import type { tournaments } from '@/db/schema.js';

type TournamentRow = typeof tournaments.$inferSelect;

const callbacks = (kb: {
  inline_keyboard: { callback_data?: string }[][];
}) => kb.inline_keyboard.flat().map((b) => b.callback_data);

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
