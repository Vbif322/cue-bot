import { describe, expect, it } from 'vitest';

import { buildTournamentTabsKeyboard } from '@/bot/ui/tournamentUI.js';

const buttons = (kb: ReturnType<typeof buildTournamentTabsKeyboard>) =>
  kb.inline_keyboard.flat() as { text: string; callback_data: string }[];

describe('buildTournamentTabsKeyboard', () => {
  it('hides the «Организую» tab and the city toggle by default', () => {
    const data = buttons(buildTournamentTabsKeyboard('current', [])).map(
      (b) => b.callback_data,
    );
    expect(data).toEqual(['tlist:current', 'tlist:archive', 'tlist:my']);
  });

  it('adds the organizing tab for organizers', () => {
    const data = buttons(
      buildTournamentTabsKeyboard('organizing', [], { organizing: true }),
    ).map((b) => b.callback_data);
    expect(data).toContain('tlist:organizing');
  });

  it('offers «Все города» while the city filter is applied, and the city back otherwise', () => {
    const narrowed = buttons(
      buildTournamentTabsKeyboard('current', [], {
        cityFilter: { city: 'Казань', mode: 'city' },
      }),
    );
    expect(
      narrowed.find((b) => b.callback_data === 'tlist:current:all')?.text,
    ).toBe('🌍 Все города');

    const widened = buttons(
      buildTournamentTabsKeyboard('current', [], {
        cityFilter: { city: 'Казань', mode: 'all' },
      }),
    );
    expect(
      widened
        .filter((b) => b.callback_data === 'tlist:current')
        .map((b) => b.text),
    ).toEqual(['· Текущие ·', '📍 Казань']);

    // Переключатель города — только на вкладке «Текущие».
    const archive = buttons(
      buildTournamentTabsKeyboard('archive', [], {
        cityFilter: { city: 'Казань', mode: 'city' },
      }),
    ).map((b) => b.callback_data);
    expect(archive).not.toContain('tlist:current:all');
  });
});
