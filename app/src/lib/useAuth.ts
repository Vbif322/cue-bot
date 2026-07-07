import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, appAuth, setAuthToken } from './api.ts';
import { getTelegramInitData } from './telegram.ts';

/**
 * Источник истины по сессии: `data.user` есть → залогинен, null → гость.
 *
 * Если куки-сессии ещё нет, а app/ открыт как Telegram Mini App (есть `initData`) —
 * прозрачно логинимся по нему прямо здесь: RequireAuth показывает Loader, пока запрос
 * не завершится, так что авто-вход не мигает страницей логина.
 */
export function useMe() {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const session = await appAuth.me();
      if (session) return session;

      const initData = getTelegramInitData();
      if (!initData) return null;
      try {
        const { user, token } = await appAuth.miniAppLogin(initData);
        // WebView Telegram часто не хранит куку — держим токен в памяти и шлём его
        // заголовком Authorization (см. apiFetch), иначе защищённые запросы 401.
        setAuthToken(token);
        // Публичные страницы могли успеть запросить данные гостем, пока шёл логин, —
        // без инвалидации их кэш (видимость, participationStatus) остался бы гостевым.
        void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
        return { user };
      } catch (e) {
        // 400/401 — невалидный/протухший initData: честный гость. Остальное (5xx,
        // 429, сеть) пробрасываем: пусть query уйдёт в retry/error, а не кэширует
        // «гостя» на staleTime при живых креденшлах.
        if (e instanceof ApiError && (e.status === 400 || e.status === 401)) {
          return null;
        }
        throw e;
      }
    },
    retry: (failureCount, error) =>
      !(error instanceof ApiError && error.status === 401) && failureCount < 2,
    staleTime: 60_000,
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => appAuth.logout(),
    onSuccess: () => {
      setAuthToken(null); // сбрасываем и Bearer-токен Mini App
      qc.setQueryData(['auth', 'me'], null);
      qc.clear();
    },
  });
}
