import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';

import type { ApiUserFederation, FederationParam } from './api.ts';
import { useMe } from './useAuth.ts';

/**
 * Текущая федерация панели: `'all'` — все (только платформенный админ),
 * `'platform'` — платформенные ресурсы без федерации (только админ), иначе id.
 */
export type FederationSelection = 'all' | 'platform' | string;

interface FederationContextValue {
  current: FederationSelection;
  setCurrent: (value: FederationSelection) => void;
  /** Федерации вошедшего (для админа — его членства, обычно пустые). */
  federations: ApiUserFederation[];
  isPlatformAdmin: boolean;
  /** Может создать свою организацию (админ или действующее право организатора). */
  canCreateFederations: boolean;
  /** Выбранная федерация как строка `ApiUserFederation`, если это одна из своих. */
  currentFederation: ApiUserFederation | null;
  /** Значение для `?federationId=`: undefined при `'all'`. */
  param: FederationParam;
  /**
   * `federationId` для создаваемых ресурсов: null = платформенный (админ в режиме
   * all/platform), иначе id. Для организатора без выбора — первая его федерация.
   */
  writeFederationId: string | null;
  /** Роль вошедшего в текущей федерации (null для админа вне своих). */
  currentRole: ApiUserFederation['role'] | null;
}

const FederationContext = createContext<FederationContextValue | null>(null);

const STORAGE_KEY = 'cue-bot.admin.federation';

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(value: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* приватный режим — просто не запоминаем */
  }
}

export function FederationProvider({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  const federations = me?.federations ?? [];
  const isPlatformAdmin = me?.isPlatformAdmin ?? false;
  const canCreateFederations = me?.canCreateFederations ?? false;

  const [stored, setStored] = useState<string | null>(readStored);

  // Нормализуем выбор под права: организатор не может быть в 'all'/'platform'
  // и не может выбрать чужую федерацию; админ без выбора — 'all'.
  const current: FederationSelection = useMemo(() => {
    const own = new Set<string>(federations.map((f) => f.id));
    if (isPlatformAdmin) {
      if (stored === 'all' || stored === 'platform') return stored;
      if (stored && own.has(stored)) return stored;
      return 'all';
    }
    if (stored && own.has(stored)) return stored;
    return federations[0]?.id ?? 'all';
  }, [federations, isPlatformAdmin, stored]);

  useEffect(() => {
    if (stored !== current) writeStored(current);
  }, [current, stored]);

  const setCurrent = useCallback((value: FederationSelection) => {
    writeStored(value);
    setStored(value);
  }, []);

  const value = useMemo<FederationContextValue>(() => {
    const currentFederation = federations.find((f) => f.id === current) ?? null;
    return {
      current,
      setCurrent,
      federations,
      isPlatformAdmin,
      canCreateFederations,
      currentFederation,
      param: current === 'all' ? undefined : current,
      writeFederationId:
        current === 'all' || current === 'platform' ? null : current,
      currentRole: currentFederation?.role ?? null,
    };
  }, [current, federations, isPlatformAdmin, canCreateFederations, setCurrent]);

  return (
    <FederationContext.Provider value={value}>
      {children}
    </FederationContext.Provider>
  );
}

export function useFederation(): FederationContextValue {
  const ctx = useContext(FederationContext);
  if (!ctx) throw new Error('useFederation outside FederationProvider');
  return ctx;
}
