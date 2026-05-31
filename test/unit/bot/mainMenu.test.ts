import { describe, expect, it } from 'vitest';

import { MENU_BUTTONS, buildMainMenuKeyboard } from '@/bot/ui/mainMenu.js';

describe('buildMainMenuKeyboard', () => {
  it('contains the three menu buttons in order', () => {
    const kb = buildMainMenuKeyboard();
    const texts = kb.keyboard.flat().map((b) => b.text);
    expect(texts).toEqual([
      MENU_BUTTONS.matches,
      MENU_BUTTONS.tournaments,
      MENU_BUTTONS.profile,
    ]);
  });

  it('is resized and persistent', () => {
    const kb = buildMainMenuKeyboard();
    expect(kb.resize_keyboard).toBe(true);
    expect(kb.is_persistent).toBe(true);
  });
});
