// Доступ к Telegram Mini App SDK (telegram-web-app.js подключён в index.html).
// Нужен только `initData` — подписанная строка для авто-входа на бэкенде.

interface TelegramWebApp {
  initData?: string;
  ready?: () => void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

/**
 * `initData` из Telegram, если app/ открыт как Mini App внутри Telegram; иначе `null`
 * (обычный браузер — SDK либо не загрузился, либо отдаёт пустую строку).
 */
export function getTelegramInitData(): string | null {
  const initData = window.Telegram?.WebApp?.initData;
  return initData && initData.length > 0 ? initData : null;
}
