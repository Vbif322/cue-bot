// Типобезопасный клиент API игрока. Типы — из ./types.ts (модель по фактическим
// ответам /api/app/*), запросы — через fetch с кукой сессии (app_token).
import type {
  AppUser,
  AppTournament,
  AppParticipant,
  AppMatch,
  GroupStanding,
  AppBracket,
  TournamentDetail,
  AppNotification,
  MeProfile,
  MeStats,
  RegisterResult,
  TelegramAuthData,
} from './types.ts';

export * from './types.ts';

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  const data = (await res.json()) as { data?: T; error?: string } | T;

  if (!res.ok) {
    const err =
      typeof data === 'object' && data !== null && 'error' in data
        ? String((data as { error: string }).error)
        : `HTTP ${res.status}`;
    throw new Error(err);
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

  /** Вход через Telegram Login Widget — payload виджета уходит на верификацию. */
  telegramLogin: (payload: TelegramAuthData) =>
    apiFetch<{ user: AppUser }>('/api/app/auth/telegram', {
      method: 'POST',
      ...jsonBody(payload),
    }),

  logout: () =>
    apiFetch<{ ok: boolean }>('/api/app/auth/logout', { method: 'POST' }),

  /** Проверка сессии. На 401 возвращаем null (гость), не бросаем ошибку. */
  me: async (): Promise<{ user: AppUser } | null> => {
    try {
      return await apiFetch<{ user: AppUser }>('/api/app/auth/me');
    } catch {
      return null;
    }
  },
};

// ── Config (публичный конфиг для SPA) ─────────────────────────────────────────

export const configApi = {
  /** Публичный конфиг: username бота для Telegram Login Widget. */
  get: () => apiFetch<{ botUsername: string | null }>('/api/app/config'),
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

  /** Привязка Telegram к текущему аккаунту (payload виджета). */
  linkTelegram: (payload: TelegramAuthData) =>
    apiFetch<{ telegramLinked: boolean }>('/api/app/me/telegram', {
      method: 'POST',
      ...jsonBody(payload),
    }),

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
