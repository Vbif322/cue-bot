import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  QueryClient,
  QueryClientProvider,
  QueryCache,
  MutationCache,
} from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import { ApiError } from './lib/api.ts';
import './index.css';

// Глобальный перехват протухшей сессии: на 401 (кроме самого ['auth','me'])
// инвалидируем сессию → me() перезапросится. В браузере вернёт null (401) → RequireAuth
// уведёт на /login; в Telegram Mini App refetch прозрачно перелогинится по initData —
// invalidate держит старые данные во время refetch, поэтому логин не мигает. Bearer уже
// сбрасывается в apiFetch. setQueryData не нужен: me() резолвится в null на 401.
let queryClient: QueryClient;
const handle401 = (err: unknown, key?: readonly unknown[]): void => {
  if (err instanceof ApiError && err.status === 401 && key?.[0] !== 'auth') {
    void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
  }
};

queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (err, query) => handle401(err, query.queryKey),
  }),
  mutationCache: new MutationCache({ onError: (err) => handle401(err) }),
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
