import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useMe } from '../lib/useAuth.ts';
import { Loader } from './ui.tsx';

/** Гард приватных роутов: без сессии → /login (с запоминанием исходного пути). */
export default function RequireAuth({ children }: { children: ReactNode }) {
  const { data, isLoading } = useMe();
  const location = useLocation();

  if (isLoading) return <Loader />;

  if (!data?.user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }

  return <>{children}</>;
}
