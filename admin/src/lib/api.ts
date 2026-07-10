// Type-safe API client — imports types from server, uses fetch at runtime
import type {
  ApiTournament,
  ApiTournamentParticipant,
  ApiGroupStanding,
  ApiPlayerStanding,
  ApiMatch,
  ApiMatchStats,
  ApiUser,
  ApiUserStats,
  ApiTable,
  ApiVenue,
  StartTournamentResponse,
  TournamentStatus,
  TournamentVisibility,
  TournamentScheduleMode,
  ITournamentFormat,
  ITournamentSport,
  ITournamentDiscipline,
  IGroupDraw,
} from '@server/apiTypes';

export type {
  ApiTournament,
  ApiTournamentParticipant,
  ApiGroupStanding,
  ApiPlayerStanding,
  ApiMatch,
  ApiMatchStats,
  ApiUser,
  ApiUserStats,
  ApiTable,
  ApiVenue,
  StartTournamentResponse,
  TournamentStatus,
  TournamentVisibility,
  TournamentScheduleMode,
  ITournamentFormat,
  ITournamentSport,
  ITournamentDiscipline,
  IGroupDraw,
};

/** Group + playoff config fields, shared by create/update payloads. */
interface GroupConfigFields {
  groupsCount?: number;
  participantsPerGroup?: number;
  qualifiersPerGroup?: number;
  groupDraw?: IGroupDraw;
}

/** Ошибка HTTP-уровня: по `status` глобальный перехватчик отличает 401 от прочих. */
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
      ...options?.headers,
    },
  });

  // Тело может быть не-JSON (пустой ответ / HTML от прокси на 401/5xx) — не даём
  // SyntaxError затмить статус, иначе ApiError(401) не построится и перехват не сработает.
  let data: { data?: T; error?: string } | T | null = null;
  try {
    data = (await res.json()) as { data?: T; error?: string } | T;
  } catch {
    /* статус скажет сам за себя */
  }

  if (!res.ok) {
    const err =
      typeof data === 'object' && data !== null && 'error' in data
        ? String((data as { error: string }).error)
        : `HTTP ${res.status}`;
    throw new ApiError(res.status, err);
  }

  // Unwrap { data: T } envelope if present
  if (typeof data === 'object' && data !== null && 'data' in data) {
    return (data as { data: T }).data;
  }

  return data as T;
}

// ── Auth ────────────────────────────────────────────────────────────────────

export const auth = {
  logout: () =>
    apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  me: () =>
    apiFetch<{ user: { id: string; username: string; role: string } | null }>(
      '/api/auth/me',
    ),
};

// ── Tournaments ──────────────────────────────────────────────────────────────

export const tournamentsApi = {
  list: () => apiFetch<ApiTournament[]>('/api/tournaments'),

  get: (id: string) => apiFetch<ApiTournament>(`/api/tournaments/${id}`),

  tables: (id: string) => apiFetch<ApiTable[]>(`/api/tournaments/${id}/tables`),

  standings: (id: string) =>
    apiFetch<ApiGroupStanding[]>(`/api/tournaments/${id}/standings`),

  create: (data: {
    name: string;
    description?: string;
    rules?: string;
    sport: ITournamentSport;
    discipline: ITournamentDiscipline;
    format: ITournamentFormat;
    randomAdvancement?: boolean;
    visibility?: TournamentVisibility;
    scheduleMode?: TournamentScheduleMode;
    maxParticipants?: number;
    winScore?: number;
    mergeRound?: number;
    startDate?: string;
    venueId: string;
    tableIds?: string[];
  } & GroupConfigFields) =>
    apiFetch<ApiTournament>('/api/tournaments', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (
    id: string,
    data: {
      name: string;
      description?: string;
      rules?: string;
      // Present for zod parity; the server ignores the pair on PATCH.
      sport: ITournamentSport;
      discipline: ITournamentDiscipline;
      format: ITournamentFormat;
      randomAdvancement?: boolean;
      visibility?: TournamentVisibility;
      scheduleMode?: TournamentScheduleMode;
      maxParticipants?: number;
      winScore?: number;
      mergeRound?: number;
      startDate?: string;
      venueId: string;
      tableIds?: string[];
    } & GroupConfigFields,
  ) =>
    apiFetch<ApiTournament>(`/api/tournaments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  setStatus: (id: string, status: TournamentStatus) =>
    apiFetch<ApiTournament>(`/api/tournaments/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  start: (id: string) =>
    apiFetch<StartTournamentResponse>(`/api/tournaments/${id}/start`, {
      method: 'POST',
    }),

  delete: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/tournaments/${id}`, { method: 'DELETE' }),

  participants: (id: string) =>
    apiFetch<ApiTournamentParticipant[]>(`/api/tournaments/${id}/participants`),

  stats: (id: string) =>
    apiFetch<ApiMatchStats>(`/api/tournaments/${id}/stats`),

  addParticipant: (
    tournamentId: string,
    body:
      | { type: 'user'; userId: string }
      | { type: 'external'; name: string; username?: string },
  ) =>
    apiFetch<{ ok: boolean }>(`/api/tournaments/${tournamentId}/participants`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  removeParticipant: (tournamentId: string, userId: string) =>
    apiFetch<{ ok: boolean }>(
      `/api/tournaments/${tournamentId}/participants/${userId}`,
      { method: 'DELETE' },
    ),

  confirmParticipant: (tournamentId: string, userId: string) =>
    apiFetch<{ ok: boolean }>(
      `/api/tournaments/${tournamentId}/participants/${userId}`,
      { method: 'PATCH', body: JSON.stringify({ action: 'confirm' }) },
    ),

  rejectParticipant: (tournamentId: string, userId: string) =>
    apiFetch<{ ok: boolean }>(
      `/api/tournaments/${tournamentId}/participants/${userId}`,
      { method: 'PATCH', body: JSON.stringify({ action: 'reject' }) },
    ),

  setParticipantSeed: (
    tournamentId: string,
    userId: string,
    seed: number | null,
  ) =>
    apiFetch<{ ok: boolean }>(
      `/api/tournaments/${tournamentId}/participants/${userId}/seed`,
      { method: 'PATCH', body: JSON.stringify({ seed }) },
    ),

  randomizeSeeds: (tournamentId: string) =>
    apiFetch<{ ok: boolean }>(
      `/api/tournaments/${tournamentId}/participants/seeds/randomize`,
      { method: 'POST' },
    ),
};

// ── Matches ──────────────────────────────────────────────────────────────────

export const matchesApi = {
  byTournament: (tournamentId: string) =>
    apiFetch<ApiMatch[]>(`/api/matches/tournament/${tournamentId}`),

  get: (id: string) => apiFetch<ApiMatch>(`/api/matches/${id}`),

  start: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/matches/${id}/start`, { method: 'POST' }),

  report: (
    id: string,
    data: { reporterId: string; player1Score: number; player2Score: number },
  ) =>
    apiFetch<{ ok: boolean }>(`/api/matches/${id}/report`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  confirm: (id: string, confirmerId: string) =>
    apiFetch<{ ok: boolean }>(`/api/matches/${id}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ confirmerId }),
    }),

  dispute: (id: string, userId: string) =>
    apiFetch<{ ok: boolean }>(`/api/matches/${id}/dispute`, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    }),

  setTechnical: (id: string, winnerId: string, reason: string) =>
    apiFetch<{ ok: boolean }>(`/api/matches/${id}/technical`, {
      method: 'POST',
      body: JSON.stringify({ winnerId, reason }),
    }),

  setTable: (id: string, tableId: string | null) =>
    apiFetch<{ ok: boolean }>(`/api/matches/${id}/table`, {
      method: 'PUT',
      body: JSON.stringify({ tableId }),
    }),

  setSchedule: (id: string, scheduledAt: string | null) =>
    apiFetch<{ ok: boolean }>(`/api/matches/${id}/schedule`, {
      method: 'PUT',
      body: JSON.stringify({ scheduledAt }),
    }),

  previewCorrection: (
    id: string,
    data: { player1Score: number; player2Score: number },
  ) =>
    apiFetch<{
      valid: boolean;
      error?: string;
      winnerChanged: boolean;
      affectedCount: number;
      willReshuffle: boolean;
      tournamentWillReopen: boolean;
    }>(`/api/matches/${id}/correct/preview`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  correct: (
    id: string,
    data: { player1Score: number; player2Score: number; reason: string },
  ) =>
    apiFetch<{
      ok: boolean;
      affectedCount: number;
      winnerChanged: boolean;
      warning?: string;
    }>(`/api/matches/${id}/correct`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  advance: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/matches/${id}/advance`, { method: 'POST' }),
};

// ── Users ────────────────────────────────────────────────────────────────────

export const usersApi = {
  list: () => apiFetch<ApiUser[]>('/api/users'),

  get: (id: string) => apiFetch<ApiUser>(`/api/users/${id}`),

  stats: (id: string) => apiFetch<ApiUserStats>(`/api/users/${id}/stats`),

  setRole: (id: string, role: 'user' | 'admin') =>
    apiFetch<ApiUser>(`/api/users/${id}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),

  update: (
    id: string,
    fields: { name?: string | null; surname?: string | null },
  ) =>
    apiFetch<ApiUser>(`/api/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(fields),
    }),

  assignReferee: (userId: string, tournamentId: string) =>
    apiFetch<{ ok: boolean }>(`/api/users/${userId}/referee`, {
      method: 'POST',
      body: JSON.stringify({ tournamentId }),
    }),

  removeReferee: (userId: string, tournamentId: string) =>
    apiFetch<{ ok: boolean }>(`/api/users/${userId}/referee/${tournamentId}`, {
      method: 'DELETE',
    }),

  delete: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/users/${id}`, { method: 'DELETE' }),
};

// ── Tables ────────────────────────────────────────────────────────────────────

export const tablesApi = {
  list: () => apiFetch<ApiTable[]>('/api/tables'),

  create: (name: string, venueId: string) =>
    apiFetch<ApiTable>('/api/tables', {
      method: 'POST',
      body: JSON.stringify({ name, venueId }),
    }),

  delete: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/tables/${id}`, { method: 'DELETE' }),
};

// ── Venues ────────────────────────────────────────────────────────────────────

export const venuesApi = {
  list: () => apiFetch<ApiVenue[]>('/api/venues'),

  create: (data: { name: string; address: string; image?: string }) =>
    apiFetch<ApiVenue>('/api/venues', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (
    id: string,
    data: { name?: string; address?: string; image?: string | null },
  ) =>
    apiFetch<ApiVenue>(`/api/venues/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/venues/${id}`, { method: 'DELETE' }),
};
