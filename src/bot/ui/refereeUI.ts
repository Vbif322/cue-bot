import type { InlineKeyboard } from 'grammy';

import { publicSiteUrl } from '@/utils/publicUrl.js';

/**
 * Links from Telegram into the referee section of the player site (`/referee`
 * in app/). Opened as a Mini App (`web_app` button), so the referee lands
 * already logged in via `initData` — no separate login.
 */

const REFEREE_BUTTON_TEXT = '📱 Пульт судьи';

/**
 * Absolute URL of a referee page, or null when there is nowhere to link (see
 * `publicSiteUrl`).
 */
export function refereeWebAppUrl(path = '/referee'): string | null {
  return publicSiteUrl(path);
}

/** The referee page of one match. */
export function refereeMatchPath(matchId: string): string {
  return `/referee/m/${matchId}`;
}

/**
 * Append a «📱 Пульт судьи» Mini App button on its own row. No-op without a
 * usable base URL, so callers never need to branch on the environment.
 */
export function addRefereeWebAppButton(
  keyboard: InlineKeyboard,
  path = '/referee',
): InlineKeyboard {
  const url = refereeWebAppUrl(path);
  if (url) keyboard.webApp(REFEREE_BUTTON_TEXT, url).row();
  return keyboard;
}
