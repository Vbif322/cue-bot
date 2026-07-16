// Типобезопасный клиент API игрока. Типы — из ./types.ts (модель по фактическим
// ответам /api/app/*), запросы — через fetch с кукой сессии (app_token).
import type {
  AppUser,
  AppTournament,
  AppParticipant,
  AppMatch,
  AppMatchFrame,
  GroupStanding,
  AppBracket,
  TournamentDetail,
  AppNotification,
  MeProfile,
  MeStats,
  RegisterResult,
} from './types.ts';

export * from './types.ts';

// Bearer-токен для Telegram Mini App: в WebView куки ненадёжны, поэтому там сессию
// держим в памяти (короткоживущий токен из ответа /telegram/miniapp) и шлём заголовком.
// В обычном браузере токен не ставится — работает кука. См. setAuthToken/useMe.
let authToken: string | null = null;
export function setAuthToken(token: string | null): void {
  authToken = token;
}

/** Ошибка HTTP-уровня: по `status` вызывающие отличают 401 (гость) от транзиентных. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...options?.headers,
    },
  });

  // Тело может быть не-JSON (HTML 502/504 от прокси) — не даём SyntaxError затмить статус.
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* статус скажет сам за себя */
  }

  if (!res.ok) {
    // Протухший Bearer не должен вечно перебивать возможную куку: сбрасываем, следующий
    // refetch ['auth','me'] прозрачно перелогинит по initData (см. useMe).
    if (res.status === 401 && authToken) setAuthToken(null);
    const err =
      typeof data === 'object' && data !== null && 'error' in data
        ? String((data as { error: string }).error)
        : `HTTP ${String(res.status)}`;
    throw new ApiError(res.status, err);
  }

  // Распаковка конверта { data: T }.
  if (typeof data === 'object' && data !== null && 'data' in data) {
    return (data as { data: T }).data;
  }

  return data as T;
}

const jsonBody = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

// ── Auth (беспарольный вход по коду на почту) ─────────────────────────────────

export const appAuth = {
  requestCode: (email: string) =>
    apiFetch<{ ok: boolean }>('/api/app/auth/request-code', {
      method: 'POST',
      ...jsonBody({ email }),
    }),

  verifyCode: (email: string, code: string) =>
    apiFetch<{ user: AppUser }>('/api/app/auth/verify-code', {
      method: 'POST',
      ...jsonBody({ email, code }),
    }),

  // Вход через Telegram в браузере — редиректный OIDC-поток, не fetch: браузер уходит
  // на GET /api/app/auth/telegram/start (см. TelegramLoginButton). Клиентского вызова нет.

  /**
   * Авто-вход из Telegram Mini App: подписанный initData уходит на верификацию.
   * Возвращает и `token` (app_token) — фронт кладёт его в Bearer на случай, если
   * кука в WebView не сохранилась.
   */
  miniAppLogin: (initData: string) =>
    apiFetch<{ user: AppUser; token: string }>('/api/app/auth/telegram/miniapp', {
      method: 'POST',
      ...jsonBody({ initData }),
    }),

  // Привязка email к текущему (обычно Telegram-only) аккаунту: два шага —
  // запросить код на адрес, затем подтвердить. Успех обновляет email-identity,
  // поэтому после confirm инвалидируйте ['me','profile'] и ['auth','me'].
  requestEmailLinkCode: (email: string) =>
    apiFetch<{ ok: boolean }>('/api/app/auth/email/request-code', {
      method: 'POST',
      ...jsonBody({ email }),
    }),

  confirmEmailLink: (email: string, code: string) =>
    apiFetch<{ user: AppUser }>('/api/app/auth/email/verify', {
      method: 'POST',
      ...jsonBody({ email, code }),
    }),

  /**
   * Подтверждение слияния текущего (email) аккаунта в Telegram-аккаунт: доступно
   * после редиректного OIDC-потока привязки, когда Telegram занят другим аккаунтом
   * (см. MeProfile.pendingMerge). Сервер сливает и перевыпускает сессию на survivor —
   * поэтому после успеха инвалидируйте ['auth','me'] и ['me',*].
   */
  confirmMerge: () =>
    apiFetch<{ user: AppUser }>('/api/app/auth/telegram/merge', {
      method: 'POST',
    }),

  logout: () =>
    apiFetch<{ ok: boolean }>('/api/app/auth/logout', { method: 'POST' }),

  /**
   * Проверка сессии. ТОЛЬКО на 401 возвращаем null (гость); транзиентные ошибки
   * (5xx, сеть) пробрасываем — иначе сбой /me неотличим от «не залогинен» и, например,
   * запускал бы авто-вход Mini App поверх живой email-сессии.
   */
  me: async (): Promise<{ user: AppUser } | null> => {
    try {
      return await apiFetch<{ user: AppUser }>('/api/app/auth/me');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return null;
      throw e;
    }
  },
};

// ── Config (публичный конфиг для SPA) ─────────────────────────────────────────

export const configApi = {
  /** Публичный конфиг: включён ли вход через Telegram (сконфигурирован OIDC-клиент). */
  get: () => apiFetch<{ telegramLoginEnabled: boolean }>('/api/app/config'),
};

// ── Tournaments ───────────────────────────────────────────────────────────────

export const tournamentsApi = {
  list: () => apiFetch<AppTournament[]>('/api/app/tournaments'),

  get: (id: string) => apiFetch<TournamentDetail>(`/api/app/tournaments/${id}`),

  participants: (id: string) =>
    apiFetch<AppParticipant[]>(`/api/app/tournaments/${id}/participants`),

  bracket: (id: string) =>
    apiFetch<AppBracket>(`/api/app/tournaments/${id}/bracket`),

  standings: (id: string) =>
    apiFetch<GroupStanding[]>(`/api/app/tournaments/${id}/standings`),

  register: (id: string) =>
    apiFetch<RegisterResult>(`/api/app/tournaments/${id}/register`, {
      method: 'POST',
    }),

  cancel: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/app/tournaments/${id}/cancel`, {
      method: 'POST',
    }),

  acceptInvitation: (id: string) =>
    apiFetch<{ ok: boolean }>(
      `/api/app/tournaments/${id}/invitation/accept`,
      { method: 'POST' },
    ),

  declineInvitation: (id: string) =>
    apiFetch<{ ok: boolean }>(
      `/api/app/tournaments/${id}/invitation/decline`,
      { method: 'POST' },
    ),

  byInviteCode: (code: string) =>
    apiFetch<AppTournament>(
      `/api/app/tournaments/invites/${encodeURIComponent(code)}`,
    ),

  joinByInviteCode: (code: string) =>
    apiFetch<RegisterResult>(
      `/api/app/tournaments/invites/${encodeURIComponent(code)}/join`,
      { method: 'POST' },
    ),
};

// ── Matches ───────────────────────────────────────────────────────────────────

export const matchesApi = {
  get: (id: string) => apiFetch<AppMatch>(`/api/app/matches/${id}`),

  report: (id: string, player1Score: number, player2Score: number) =>
    apiFetch<{ ok: boolean }>(`/api/app/matches/${id}/report`, {
      method: 'POST',
      ...jsonBody({ player1Score, player2Score }),
    }),

  frames: (id: string) =>
    apiFetch<AppMatchFrame[]>(`/api/app/matches/${id}/frames`),

  reportFrames: (
    id: string,
    frames: Array<{
      player1Points: number;
      player2Points: number;
      player1Break?: number | null;
      player2Break?: number | null;
    }>,
  ) =>
    apiFetch<{ ok: boolean }>(`/api/app/matches/${id}/report-frames`, {
      method: 'POST',
      ...jsonBody({ frames }),
    }),

  confirm: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/app/matches/${id}/confirm`, {
      method: 'POST',
    }),

  dispute: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/app/matches/${id}/dispute`, {
      method: 'POST',
    }),
};

// ── Me / profile ──────────────────────────────────────────────────────────────

export const meApi = {
  get: () => apiFetch<MeProfile>('/api/app/me'),

  update: (body: { name?: string | null; surname?: string | null }) =>
    apiFetch<AppUser>('/api/app/me', { method: 'PATCH', ...jsonBody(body) }),

  // Привязка Telegram — тоже редиректный OIDC-поток:
  // GET /api/app/auth/telegram/start?link=1 (см. TelegramLoginButton). Клиентского вызова нет.

  stats: () => apiFetch<MeStats>('/api/app/me/stats'),

  tournaments: () => apiFetch<AppTournament[]>('/api/app/me/tournaments'),

  matches: () =>
    apiFetch<{ active: AppMatch[]; history: AppMatch[] }>(
      '/api/app/me/matches',
    ),
};

// ── Notifications ─────────────────────────────────────────────────────────────

export const notificationsApi = {
  list: (opts?: { unreadOnly?: boolean; limit?: number }) => {
    const params = new URLSearchParams();
    if (opts?.unreadOnly) params.set('unread', '1');
    if (opts?.limit) params.set('limit', String(opts.limit));
    const qs = params.toString();
    return apiFetch<AppNotification[]>(
      `/api/app/notifications${qs ? `?${qs}` : ''}`,
    );
  },

  markRead: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/app/notifications/${id}/read`, {
      method: 'POST',
    }),

  markAllRead: () =>
    apiFetch<{ ok: boolean }>('/api/app/notifications/read-all', {
      method: 'POST',
    }),
};
