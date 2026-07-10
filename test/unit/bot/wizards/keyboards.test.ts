import { describe, expect, it } from 'vitest';

import { TournamentCreationKeyboards } from '@/bot/wizards/tournamentCreation/tournamentCreation.keyboards.js';
import {
  sports,
  SPORT_DISCIPLINES,
  formats,
  maxParticipants,
  scheduleModes,
  visibilities,
  winScores,
  groupsCountOptions,
  participantsPerGroupOptions,
} from '@/db/schema/tournaments.js';

const kbds = new TournamentCreationKeyboards();

// uuid-shaped ids: venue/table id columns are typed `crypto.UUID`, so the
// fixtures must match `${string}-${string}-...`; the literals double as the
// expected callback payloads below.
const VENUE_A = '00000000-0000-0000-0000-00000000000a';
const VENUE_B = '00000000-0000-0000-0000-00000000000b';
const TABLE_1 = '00000000-0000-0000-0000-000000000001';
const TABLE_2 = '00000000-0000-0000-0000-000000000002';

/** Flatten an InlineKeyboard into a list of {text, data} buttons. */
const buttons = (kb: { inline_keyboard: { text: string; callback_data?: string }[][] }) =>
  kb.inline_keyboard.flat().map((b) => ({ text: b.text, data: b.callback_data }));

describe('TournamentCreationKeyboards', () => {
  it('buildVenuesKeyboard: one button per venue with tc:venue:<id> callback', () => {
    const kb = kbds.buildVenuesKeyboard([
      { id: VENUE_A, name: 'Hall A' },
      { id: VENUE_B, name: 'Hall B' },
    ]);
    expect(buttons(kb)).toEqual([
      { text: 'Hall A', data: `tc:venue:${VENUE_A}` },
      { text: 'Hall B', data: `tc:venue:${VENUE_B}` },
    ]);
  });

  it('buildVisibilityKeyboard: one button per visibility with tc:visibility:<v>', () => {
    const btns = buttons(kbds.buildVisibilityKeyboard());
    expect(btns.map((b) => b.data)).toEqual(
      visibilities.map((v) => `tc:visibility:${v}`),
    );
    expect(btns.map((b) => b.text)).toEqual(['Открытый', 'Закрытый']);
  });

  it('buildScheduleModeKeyboard: one button per mode with tc:schedule:<m>', () => {
    const btns = buttons(kbds.buildScheduleModeKeyboard());
    expect(btns.map((b) => b.data)).toEqual(
      scheduleModes.map((m) => `tc:schedule:${m}`),
    );
    expect(btns.map((b) => b.text)).toEqual(['Один день', 'По матчам']);
  });

  it('buildSportKeyboard: one button per sport with tc:sport:<s>', () => {
    const btns = buttons(kbds.buildSportKeyboard());
    expect(btns.map((b) => b.data)).toEqual(
      sports.map((s) => `tc:sport:${s}`),
    );
    expect(btns.map((b) => b.text)).toEqual([
      'Снукер',
      'Пул',
      'Русский бильярд',
    ]);
  });

  it('buildDisciplineKeyboard: only the chosen sport’s disciplines', () => {
    for (const sport of sports) {
      const btns = buttons(kbds.buildDisciplineKeyboard(sport));
      expect(btns.map((b) => b.data)).toEqual(
        SPORT_DISCIPLINES[sport].map((d) => `tc:discipline:${d}`),
      );
    }
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
      maxParticipants.map((v) => `tc:participants:${String(v)}`),
    );
  });

  it('buildWinScoreKeyboard: one button per allowed win score', () => {
    const btns = buttons(kbds.buildWinScoreKeyboard());
    expect(btns.map((b) => b.data)).toEqual(
      winScores.map((v) => `tc:winscore:${String(v)}`),
    );
  });

  it('buildGroupsCountKeyboard: one button per groups-count option', () => {
    const btns = buttons(kbds.buildGroupsCountKeyboard());
    expect(btns.map((b) => b.data)).toEqual(
      groupsCountOptions.map((v) => `tc:groups:${String(v)}`),
    );
  });

  it('buildParticipantsPerGroupKeyboard: one button per option', () => {
    const btns = buttons(kbds.buildParticipantsPerGroupKeyboard());
    expect(btns.map((b) => b.data)).toEqual(
      participantsPerGroupOptions.map((v) => `tc:ppg:${String(v)}`),
    );
  });

  it('buildQualifiersPerGroupKeyboard: 1..(size-1), capped at 4', () => {
    expect(
      buttons(kbds.buildQualifiersPerGroupKeyboard(4)).map((b) => b.data),
    ).toEqual(['tc:qpg:1', 'tc:qpg:2', 'tc:qpg:3']);
    // capped at 4 for a size-6 group
    expect(
      buttons(kbds.buildQualifiersPerGroupKeyboard(6)).map((b) => b.data),
    ).toEqual(['tc:qpg:1', 'tc:qpg:2', 'tc:qpg:3', 'tc:qpg:4']);
  });

  it('buildGroupDrawKeyboard: snake and random options', () => {
    const btns = buttons(kbds.buildGroupDrawKeyboard());
    expect(btns.map((b) => b.data)).toEqual(['tc:draw:snake', 'tc:draw:random']);
  });

  it('buildTablesKeyboard: marks selected tables and adds control buttons', () => {
    const kb = kbds.buildTablesKeyboard(
      [
        { id: TABLE_1, name: 'Table 1' },
        { id: TABLE_2, name: 'Table 2' },
      ],
      [TABLE_1],
    );
    const btns = buttons(kb);
    expect(btns).toContainEqual({ text: '✅ Table 1', data: `tc:tables_toggle:${TABLE_1}` });
    expect(btns).toContainEqual({ text: '⬜ Table 2', data: `tc:tables_toggle:${TABLE_2}` });
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
