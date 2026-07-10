// Выбор и синхронизация темы (светлая/тёмная) для app/.
//
// Приоритет источника темы (и при загрузке, и при живых обновлениях):
//   1) Telegram Mini App — WebApp.colorScheme (реагируем на событие themeChanged);
//   2) обычный браузер — prefers-color-scheme.
//
// Значения цветов живут в app/src/theme.css как токены под :root[data-theme='…'];
// здесь мы лишь проставляем сам data-theme. Тот же выбор дублирует pre-paint
// скрипт в index.html, чтобы не мигать неправильной темой до монтирования React.

import { useEffect } from 'react';
import { getTelegramColorScheme, getTelegramWebApp, isTelegram } from './telegram.ts';

export type Theme = 'light' | 'dark';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Текущая желаемая тема по приоритету Telegram → prefers-color-scheme. */
export function resolveTheme(): Theme {
  const tg = getTelegramColorScheme();
  if (tg) return tg;
  return window.matchMedia?.(DARK_QUERY).matches ? 'dark' : 'light';
}

/** Проставляет data-theme и синхронизирует нативный хром (meta + Telegram). */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;

  // Цвет фона берём из уже применённого токена — одна точка правды.
  const surface = getComputedStyle(root).getPropertyValue('--surface-base').trim();
  if (surface) {
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', surface);
    // setBackgroundColor/setHeaderColor требуют Bot API 6.1+; на 6.0 методы есть,
    // но не поддержаны — вызов лишь пишет предупреждение в консоль. Гейтим по версии.
    const tg = getTelegramWebApp();
    if (tg?.isVersionAtLeast?.('6.1')) {
      tg.setBackgroundColor?.(surface);
      tg.setHeaderColor?.(surface);
    }
  }
}

/**
 * Держит data-theme в актуальном состоянии на всё время жизни приложения:
 * подписывается и на Telegram themeChanged, и на смену prefers-color-scheme.
 */
export function useThemeSync(): void {
  useEffect(() => {
    const tg = getTelegramWebApp();
    tg?.ready?.();

    const sync = (): void => applyTheme(resolveTheme());
    sync();

    // В Telegram слушаем themeChanged; в браузере — системную схему.
    if (isTelegram()) {
      tg?.onEvent?.('themeChanged', sync);
      return () => tg?.offEvent?.('themeChanged', sync);
    }
    const mq = window.matchMedia?.(DARK_QUERY);
    mq?.addEventListener('change', sync);
    return () => mq?.removeEventListener('change', sync);
  }, []);
}
