import type { InlineKeyboard } from 'grammy';
import { describe, expect, it } from 'vitest';
import type { UUID } from 'crypto';

import {
  buildFrameEntryView,
  type FrameReportState,
} from '@/bot/ui/frameEntryUI.js';
import type { MatchWithPlayers } from '@/bot/@types/match.js';
import type { Tournament } from '@/bot/@types/tournament.js';
import type { FrameInput } from '@/services/matchService.js';

const ID = '33333333-3333-3333-3333-333333333333' as UUID;

const buttons = (kb: InlineKeyboard) =>
  kb.inline_keyboard
    .flat()
    .map((b) => [b.text, 'callback_data' in b ? b.callback_data : undefined]);
const labels = (kb: InlineKeyboard) => buttons(kb).map(([t]) => t);

const match = {
  id: ID,
  winScore: 2,
  player1Username: null,
  player1Name: 'Иван',
  player1Surname: null,
  player1TelegramId: null,
  player2Username: null,
  player2Name: 'Пётр',
  player2Surname: null,
  player2TelegramId: null,
} as unknown as MatchWithPlayers;

const tournament = { winScore: 3 } as unknown as Tournament;

const state = (mode?: FrameReportState['mode']): FrameReportState => ({
  matchId: ID,
  mode,
  promptChatId: 1,
  promptMessageId: 2,
});

const one: FrameInput[] = [{ player1Points: 74, player2Points: 15 }];
const decided: FrameInput[] = [
  { player1Points: 74, player2Points: 15, player1Break: 45 },
  { player1Points: 60, player2Points: 20 },
];

describe('buildFrameEntryView', () => {
  it('starts with only «Выйти» before any frame', () => {
    const view = buildFrameEntryView(state(), [], match, tournament);
    expect(labels(view.keyboard)).toEqual(['⏸ Выйти']);
    expect(view.text).toContain('Отправьте счёт следующего фрейма');
  });

  it('offers undo, edit and last-frame breaks once frames exist', () => {
    const view = buildFrameEntryView(state(), one, match, tournament);
    expect(labels(view.keyboard)).toEqual([
      '↩️ Отменить фрейм',
      '✏️ Изменить фрейм',
      '🎯 Брейк P1',
      '🎯 Брейк P2',
      '⏸ Выйти',
    ]);
  });

  it('adds «Завершить» and lists breaks once decided', () => {
    const view = buildFrameEntryView(state(), decided, match, tournament);
    expect(labels(view.keyboard)[0]).toBe('✅ Завершить');
    expect(view.text).toContain('1) 74 : 15  🎯 P1 брейк 45');
    expect(view.text).toContain('Счёт достигнут (2 : 0)');
  });

  it('lists frames to pick for editing', () => {
    const view = buildFrameEntryView(
      state({ kind: 'pick' }),
      decided,
      match,
      tournament,
    );
    expect(buttons(view.keyboard)).toEqual([
      ['1) 74 : 15', `match:frame:edit:${ID}:1`],
      ['2) 60 : 20', `match:frame:edit:${ID}:2`],
      ['↩️ Назад', `match:frame:back:${ID}`],
      ['⏸ Выйти', `match:frame:cancel:${ID}`],
    ]);
  });

  it('edits one frame: new score or that frame’s breaks', () => {
    const view = buildFrameEntryView(
      state({ kind: 'edit', frameNumber: 1 }),
      decided,
      match,
      tournament,
    );
    expect(view.text).toContain('*Фрейм 1* (74 : 15). Отправьте новый счёт');
    expect(labels(view.keyboard)).toEqual([
      '🎯 Брейк P1',
      '🎯 Брейк P2',
      '↩️ Назад',
      '⏸ Выйти',
    ]);
  });

  it('prompts for a break of the chosen frame', () => {
    const view = buildFrameEntryView(
      state({ kind: 'break', frameNumber: 1, slot: 'player2', fromEdit: true }),
      decided,
      match,
      tournament,
    );
    expect(view.text).toContain('Введите макс. брейк для *Пётр* (фрейм 1)');
    expect(labels(view.keyboard)).toEqual(['↩️ Назад', '⏸ Выйти']);
  });

  it('keeps callback data within Telegram’s 64-byte limit', () => {
    const view = buildFrameEntryView(
      state({ kind: 'pick' }),
      decided,
      match,
      tournament,
    );
    for (const [, data] of buttons(view.keyboard)) {
      expect(Buffer.byteLength(data ?? '')).toBeLessThanOrEqual(64);
    }
  });
});
