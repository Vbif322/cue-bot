import { Keyboard } from 'grammy';

export const MENU_BUTTONS = {
  matches: '🎱 Мои матчи',
  tournaments: '📋 Турниры',
  profile: '👤 Профиль',
} as const;

export function buildMainMenuKeyboard(): Keyboard {
  return new Keyboard()
    .text(MENU_BUTTONS.matches)
    .text(MENU_BUTTONS.tournaments)
    .text(MENU_BUTTONS.profile)
    .resized()
    .persistent();
}
