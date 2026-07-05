// Вход/привязка через Telegram по OIDC — простой полностраничный редирект на
// бэкенд (GET /api/app/auth/telegram/start), никакого виджета/скрипта/попапа. Сервер
// уводит браузер на oauth.telegram.org и возвращает обратно, выставив сессию (или
// привязав Telegram при ?link=1). Кнопка — обычная ссылка.
import { useQuery } from '@tanstack/react-query';
import { configApi } from '../lib/api.ts';

interface Props {
  /** true → привязка к текущему аккаунту (start?link=1); иначе вход. */
  link?: boolean;
  size?: 'large' | 'medium';
}

/**
 * Включён ли вход через Telegram (GET /api/app/config → telegramLoginEnabled),
 * `false` пока не загружен. Позволяет странице скрыть всю обёртку (разделитель,
 * заголовок), а не только кнопку. Запрос дедуплицируется общим ключом ['config'].
 */
export function useTelegramLoginEnabled(): boolean {
  const { data } = useQuery({
    queryKey: ['config'],
    queryFn: () => configApi.get(),
    staleTime: Infinity,
  });
  return data?.telegramLoginEnabled ?? false;
}

export function TelegramLoginButton({ link = false, size = 'large' }: Props) {
  const enabled = useTelegramLoginEnabled();
  if (!enabled) return null;

  const href = `/api/app/auth/telegram/start${link ? '?link=1' : ''}`;
  const pad = size === 'large' ? '11px 18px' : '9px 14px';

  return (
    <a
      href={href}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: pad,
        borderRadius: 10,
        background: '#54a9eb',
        color: '#fff',
        fontWeight: 600,
        fontSize: size === 'large' ? 15 : 14,
        textDecoration: 'none',
        border: 'none',
        cursor: 'pointer',
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M12 0C5.37 0 0 5.37 0 12s5.37 12 12 12 12-5.37 12-12S18.63 0 12 0Zm5.56 8.16-1.86 8.76c-.14.62-.5.77-1.02.48l-2.82-2.08-1.36 1.31c-.15.15-.28.28-.57.28l.2-2.88 5.24-4.73c.23-.2-.05-.31-.35-.11l-6.48 4.08-2.79-.87c-.61-.19-.62-.61.13-.9l10.9-4.2c.5-.19.95.11.79.9Z" />
      </svg>
      {link ? 'Привязать Telegram' : 'Войти через Telegram'}
    </a>
  );
}
