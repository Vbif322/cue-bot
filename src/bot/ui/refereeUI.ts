import type { InlineKeyboard } from 'grammy';

/**
 * Links from Telegram into the referee section of the player site (`/referee`
 * in app/). Opened as a Mini App (`web_app` button), so the referee lands
 * already logged in via `initData` — no separate login.
 */

const REFEREE_BUTTON_TEXT = '📱 Пульт судьи';

/**
 * Absolute URL of a referee page, or null when there is nowhere to link:
 * Telegram accepts only https for `web_app`, and PUBLIC_BASE_URL is unset in
 * plain dev (an https tunnel sets it). Read per call so tests can stub it.
 */
export function refereeWebAppUrl(path = '/referee'): string | null {
  const base = process.env.PUBLIC_BASE_URL?.trim();
  if (!base?.startsWith('https://')) return null;
  return `${base.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
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
