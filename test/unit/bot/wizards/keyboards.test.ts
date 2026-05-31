import { describe, expect, it } from 'vitest';

import { TournamentCreationKeyboards } from '@/bot/wizards/tournamentCreation/tournamentCreation.keyboards.js';
import {
  disciplines,
  formats,
  maxParticipants,
  winScores,
} from '@/db/schema/tournaments.js';

const kbds = new TournamentCreationKeyboards();

/** Flatten an InlineKeyboard into a list of {text, data} buttons. */
const buttons = (kb: { inline_keyboard: Array<Array<{ text: string; callback_data?: string }>> }) =>
  kb.inline_keyboard.flat().map((b) => ({ text: b.text, data: b.callback_data }));

describe('TournamentCreationKeyboards', () => {
  it('buildVenuesKeyboard: one button per venue with tc:venue:<id> callback', () => {
    const kb = kbds.buildVenuesKeyboard([
      { id: 'v1', name: 'Hall A' },
      { id: 'v2', name: 'Hall B' },
    ]);
    expect(buttons(kb)).toEqual([
      { text: 'Hall A', data: 'tc:venue:v1' },
      { text: 'Hall B', data: 'tc:venue:v2' },
    ]);
  });

  it('buildDisciplineKeyboard: one button per discipline', () => {
    const btns = buttons(kbds.buildDisciplineKeyboard());
    expect(btns).toHaveLength(disciplines.length);
    expect(btns.every((b) => b.data?.startsWith('tc:discipline:'))).toBe(true);
  });

  it('buildFormatKeyboard: one button per format', () => {
    const btns = buttons(kbds.buildFormatKeyboard());
    expect(btns).toHaveLength(formats.length);
    expect(btns.map((b) => b.data)).toEqual(
      formats.map((f) => `tc:format:${f}`),
    );
  });

  it('buildParticipantsKeyboard: one button per allowed count', () => {
    const btns = buttons(kbds.buildParticipantsKeyboard());
    expect(btns.map((b) => b.data)).toEqual(
      maxParticipants.map((v) => `tc:participants:${v}`),
    );
  });

  it('buildWinScoreKeyboard: one button per allowed win score', () => {
    const btns = buttons(kbds.buildWinScoreKeyboard());
    expect(btns.map((b) => b.data)).toEqual(
      winScores.map((v) => `tc:winscore:${v}`),
    );
  });

  it('buildTablesKeyboard: marks selected tables and adds control buttons', () => {
    const kb = kbds.buildTablesKeyboard(
      [
        { id: 't1', name: 'Table 1' },
        { id: 't2', name: 'Table 2' },
      ],
      ['t1'],
    );
    const btns = buttons(kb);
    expect(btns).toContainEqual({ text: '✅ Table 1', data: 'tc:tables_toggle:t1' });
    expect(btns).toContainEqual({ text: '⬜ Table 2', data: 'tc:tables_toggle:t2' });
    expect(btns.map((b) => b.data)).toEqual(
      expect.arrayContaining(['tc:tables_done', 'tc:tables_skip', 'tc:tables_all']),
    );
  });

  it('buildTournamentCreatedKeyboard: open-registration button with id', () => {
    const btns = buttons(kbds.buildTournamentCreatedKeyboard('abc'));
    expect(btns).toEqual([
      { text: 'Открыть регистрацию', data: 'tournament_open_reg:abc' },
    ]);
  });
});
