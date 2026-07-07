// Доступ к Telegram Mini App SDK (telegram-web-app.js подключён в index.html).
// Нужны `initData` (подписанная строка для авто-входа) и тема пользователя.

type TelegramColorScheme = 'light' | 'dark';

interface TelegramThemeParams {
  bg_color?: string;
  text_color?: string;
  [key: string]: string | undefined;
}

interface TelegramWebApp {
  initData?: string;
  colorScheme?: TelegramColorScheme;
  themeParams?: TelegramThemeParams;
  ready?: () => void;
  setBackgroundColor?: (color: string) => void;
  setHeaderColor?: (color: string) => void;
  onEvent?: (event: string, handler: () => void) => void;
  offEvent?: (event: string, handler: () => void) => void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

/** WebApp-объект Telegram, если app/ открыт как Mini App; иначе `undefined`. */
export function getTelegramWebApp(): TelegramWebApp | undefined {
  return window.Telegram?.WebApp;
}

/** true, если приложение запущено внутри Telegram (SDK отдаёт colorScheme). */
export function isTelegram(): boolean {
  return Boolean(getTelegramWebApp()?.colorScheme);
}

/** Тема пользователя из Telegram ('light' | 'dark'), либо `null` вне Telegram. */
export function getTelegramColorScheme(): TelegramColorScheme | null {
  return getTelegramWebApp()?.colorScheme ?? null;
}

/**
 * `initData` из Telegram, если app/ открыт как Mini App внутри Telegram; иначе `null`
 * (обычный браузер — SDK либо не загрузился, либо отдаёт пустую строку).
 */
export function getTelegramInitData(): string | null {
  const initData = getTelegramWebApp()?.initData;
  return initData && initData.length > 0 ? initData : null;
}
