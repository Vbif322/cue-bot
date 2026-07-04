import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { appAuth } from './api.ts';

/** Источник истины по сессии: `data.user` есть → залогинен, null → гость. */
export function useMe() {
  return useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => appAuth.me(),
    retry: false,
    staleTime: 60_000,
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => appAuth.logout(),
    onSuccess: () => {
      qc.setQueryData(['auth', 'me'], null);
      qc.clear();
    },
  });
}
