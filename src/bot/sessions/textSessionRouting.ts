import { MENU_BUTTONS } from '../ui/mainMenu.js';
import type { TextSessionInfo } from './textSessionRegistry.js';

/** Чистые решения маршрутизации текстовых сессий (без БД и grammY). */

export type MessageClass = 'cancel' | 'command' | 'menu' | 'text';

const MENU_TEXTS: ReadonlySet<string> = new Set(Object.values(MENU_BUTTONS));

export function classifyMessage(text: string): MessageClass {
  if (text.startsWith('/')) {
    // "/cancel", "/cancel@bot", "/cancel args"
    const command = text.slice(1).split(/[\s@]/, 1)[0]?.toLowerCase();
    return command === 'cancel' ? 'cancel' : 'command';
  }
  if (MENU_TEXTS.has(text)) return 'menu';
  return 'text';
}

export type GuardInput =
  | { kind: 'callback'; data: string }
  | { kind: 'message'; cls: MessageClass }
  | { kind: 'other' };

export type GuardDecision =
  | 'pass'
  | 'block-callback'
  | 'block-message'
  | 'end-then-pass';

/**
 * Что делать с апдейтом при активной сессии `active`:
 * - blocking: свои callback'и, /cancel и текст проходят; чужие callback'и,
 *   команды и кнопки меню блокируются;
 * - мягкая: callback'и, /cancel и текст проходят; команда или кнопка меню
 *   сначала завершает сессию, потом выполняется.
 */
export function decideGuard(
  active: TextSessionInfo | undefined,
  input: GuardInput,
): GuardDecision {
  if (!active) return 'pass';

  switch (input.kind) {
    case 'callback':
      if (!active.blocking) return 'pass';
      return active.callbackPrefix !== undefined &&
        input.data.startsWith(active.callbackPrefix)
        ? 'pass'
        : 'block-callback';
    case 'message':
      if (input.cls === 'cancel' || input.cls === 'text') return 'pass';
      return active.blocking ? 'block-message' : 'end-then-pass';
    case 'other':
      return 'pass';
  }
}

/** Может ли решение guard'а быть не `pass` — иначе сессию можно не загружать. */
export function guardNeedsSession(input: GuardInput): boolean {
  return (
    input.kind === 'callback' ||
    (input.kind === 'message' &&
      (input.cls === 'command' || input.cls === 'menu'))
  );
}

export function blockedCallbackText(name: string): string {
  return `Сначала завершите или отмените ${name}`;
}

export function blockedMessageText(name: string): string {
  return (
    `Вы находитесь в процессе: ${name}.\n` +
    'Завершите его или отмените командой /cancel'
  );
}

export const NOTHING_TO_CANCEL_TEXT = 'Нечего отменять.';
