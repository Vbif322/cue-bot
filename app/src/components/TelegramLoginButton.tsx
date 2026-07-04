// Telegram Login Widget: подгружает telegram-widget.js с data-telegram-login =
// username бота (из GET /api/app/config) и вызывает onAuth с payload виджета.
// Виджет умеет вернуть данные только через ГЛОБАЛЬНУЮ функцию (data-onauth),
// поэтому на каждый монтаж вешаем уникально именованный колбэк на window и
// снимаем его при размонтировании. Не работает с localhost — нужен домен из
// /setdomain у @BotFather (см. README «Вход через Telegram»).
import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { configApi } from '../lib/api.ts';
import type { TelegramAuthData } from '../lib/types.ts';

let callbackSeq = 0;

interface Props {
  onAuth: (data: TelegramAuthData) => void;
  size?: 'large' | 'medium' | 'small';
}

type WindowWithCallbacks = Window &
  Record<string, ((user: TelegramAuthData) => void) | undefined>;

/**
 * Username бота из публичного конфига (GET /api/app/config), `null` пока не
 * загружен или если `BOT_USERNAME` не задан на сервере. Позволяет странице
 * скрыть всю обёртку вокруг виджета (разделитель, заголовок блока), а не только
 * саму кнопку, когда вход через Telegram недоступен. Запрос дедуплицируется с
 * тем, что делает {@link TelegramLoginButton} — общий ключ ['config'].
 */
export function useBotUsername(): string | null {
  const { data: config } = useQuery({
    queryKey: ['config'],
    queryFn: () => configApi.get(),
    staleTime: Infinity,
  });
  return config?.botUsername ?? null;
}

export function TelegramLoginButton({ onAuth, size = 'large' }: Props) {
  const botUsername = useBotUsername();

  const containerRef = useRef<HTMLDivElement>(null);
  // Держим актуальный onAuth в ref — глобальный колбэк ниже вешается один раз на
  // монтаж, но должен звать текущий обработчик без переинъекции скрипта.
  const onAuthRef = useRef(onAuth);
  onAuthRef.current = onAuth;

  useEffect(() => {
    const container = containerRef.current;
    if (!botUsername || !container) return;

    const win = window as unknown as WindowWithCallbacks;
    const callbackName = `onTelegramAuth_${String(callbackSeq++)}`;
    win[callbackName] = (user) => {
      onAuthRef.current(user);
    };

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', botUsername);
    script.setAttribute('data-size', size);
    script.setAttribute('data-userpic', 'false');
    script.setAttribute('data-request-access', 'write');
    script.setAttribute('data-onauth', `${callbackName}(user)`);
    container.appendChild(script);

    return () => {
      container.innerHTML = '';
      win[callbackName] = undefined;
    };
  }, [botUsername, size]);

  if (!botUsername) return null;
  return <div ref={containerRef} />;
}
