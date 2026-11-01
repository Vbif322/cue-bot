import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { refereeApi } from './api.ts';
import { useMe } from './useAuth.ts';

/**
 * Турниры судьи и «Требует внимания». Один ключ кэша на всё приложение: меню
 * читает его редко (только чтобы показать пункт «Судья»), экраны пульта —
 * поллят (`poll`), пока открыты.
 */
export function useRefereeOverview({ poll = false }: { poll?: boolean } = {}) {
  const { data: me } = useMe();
  return useQuery({
    queryKey: ['referee', 'overview'],
    queryFn: () => refereeApi.overview(),
    enabled: !!me?.user,
    staleTime: poll ? 0 : 5 * 60_000,
    refetchInterval: poll ? 20_000 : false,
  });
}

/** Показывать ли раздел судьи: админ или назначен судьёй хотя бы в одном турнире. */
export function useIsReferee(): boolean {
  const { data: me } = useMe();
  const { data } = useRefereeOverview();
  return me?.user?.isAdmin === true || (data?.tournaments.length ?? 0) > 0;
}

/** Текущее время, обновляемое раз в `intervalMs` — для обратных отсчётов. */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Заголовок вкладки для раздела судьи («Пульт судьи — …»); при уходе со
 * страницы возвращает прежний.
 */
export function useRefereeTitle(subject?: string | null): void {
  const title = subject ? `Пульт судьи — ${subject}` : 'Пульт судьи';
  useEffect(() => {
    const prev = document.title;
    document.title = title;
    return () => {
      document.title = prev;
    };
  }, [title]);
}
