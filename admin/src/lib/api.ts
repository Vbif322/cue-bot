// Type-safe API client — imports types from server, uses fetch at runtime
import type {
  ApiTournament,
  ApiTournamentParticipant,
  ApiMatch,
  ApiMatchStats,
  ApiUser,
  StartTournamentResponse,
  TournamentStatus,
} from "@server/apiTypes";

export type {
  ApiTournament,
  ApiTournamentParticipant,
  ApiMatch,
  ApiMatchStats,
  ApiUser,
  StartTournamentResponse,
  TournamentStatus,
};

async function apiFetch<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  const data = (await res.json()) as { data?: T; error?: string } | T;

  if (!res.ok) {
    const err =
      typeof data === "object" && data !== null && "error" in data
        ? String((data as { error: string }).error)
        : `HTTP ${res.status}`;
    throw new Error(err);
  }

  // Unwrap { data: T } envelope if present
  if (typeof data === "object" && data !== null && "data" in data) {
    return (data as { data: T }).data;
  }

  return data as T;
}

// ── Auth ────────────────────────────────────────────────────────────────────

export const auth = {
  requestCode: (username: string) =>
    apiFetch<{ ok: boolean }>("/api/auth/request-code", {
      method: "POST",
      body: JSON.stringify({ username }),
    }),

  verifyCode: (username: string, code: string) =>
    apiFetch<{ user: { id: string; username: string; role: string } }>(
      "/api/auth/verify-code",
      { method: "POST", body: JSON.stringify({ username, code }) },
    ),

  logout: () =>
    apiFetch<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),

  me: () =>
    apiFetch<{ user: { id: string; username: string; role: string } | null }>(
      "/api/auth/me",
    ),
};

// ── Tournaments ──────────────────────────────────────────────────────────────

export const tournamentsApi = {
  list: () => apiFetch<ApiTournament[]>("/api/tournaments"),

  get: (id: string) => apiFetch<ApiTournament>(`/api/tournaments/${id}`),

  create: (data: {
    name: string;
    description?: string;
    rules?: string;
    format: "single_elimination" | "double_elimination" | "round_robin";
    maxParticipants?: number;
    winScore?: number;
    startDate?: string;
  }) =>
    apiFetch<ApiTournament>("/api/tournaments", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  setStatus: (id: string, status: TournamentStatus) =>
    apiFetch<ApiTournament>(`/api/tournaments/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),

  start: (id: string) =>
    apiFetch<StartTournamentResponse>(`/api/tournaments/${id}/start`, {
      method: "POST",
    }),

  delete: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/tournaments/${id}`, { method: "DELETE" }),

  participants: (id: string) =>
    apiFetch<ApiTournamentParticipant[]>(`/api/tournaments/${id}/participants`),

  stats: (id: string) => apiFetch<ApiMatchStats>(`/api/tournaments/${id}/stats`),

  addParticipant: (tournamentId: string, userId: string) =>
    apiFetch<{ ok: boolean }>(`/api/tournaments/${tournamentId}/participants`, {
      method: "POST",
      body: JSON.stringify({ userId }),
    }),

  removeParticipant: (tournamentId: string, userId: string) =>
    apiFetch<{ ok: boolean }>(
      `/api/tournaments/${tournamentId}/participants/${userId}`,
      { method: "DELETE" },
    ),
};

// ── Matches ──────────────────────────────────────────────────────────────────

export const matchesApi = {
  byTournament: (tournamentId: string) =>
    apiFetch<ApiMatch[]>(`/api/matches/tournament/${tournamentId}`),

  get: (id: string) => apiFetch<ApiMatch>(`/api/matches/${id}`),

  start: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/matches/${id}/start`, { method: "POST" }),

  report: (
    id: string,
    data: { reporterId: string; player1Score: number; player2Score: number },
  ) =>
    apiFetch<{ ok: boolean }>(`/api/matches/${id}/report`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  confirm: (id: string, confirmerId: string) =>
    apiFetch<{ ok: boolean }>(`/api/matches/${id}/confirm`, {
      method: "POST",
      body: JSON.stringify({ confirmerId }),
    }),

  dispute: (id: string, userId: string) =>
    apiFetch<{ ok: boolean }>(`/api/matches/${id}/dispute`, {
      method: "POST",
      body: JSON.stringify({ userId }),
    }),

  setTechnical: (id: string, winnerId: string, reason: string) =>
    apiFetch<{ ok: boolean }>(`/api/matches/${id}/technical`, {
      method: "POST",
      body: JSON.stringify({ winnerId, reason }),
    }),
};

// ── Users ────────────────────────────────────────────────────────────────────

export const usersApi = {
  list: () => apiFetch<ApiUser[]>("/api/users"),

  get: (id: string) => apiFetch<ApiUser>(`/api/users/${id}`),

  setRole: (id: string, role: "user" | "admin") =>
    apiFetch<ApiUser>(`/api/users/${id}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    }),

  assignReferee: (userId: string, tournamentId: string) =>
    apiFetch<{ ok: boolean }>(`/api/users/${userId}/referee`, {
      method: "POST",
      body: JSON.stringify({ tournamentId }),
    }),

  removeReferee: (userId: string, tournamentId: string) =>
    apiFetch<{ ok: boolean }>(
      `/api/users/${userId}/referee/${tournamentId}`,
      { method: "DELETE" },
    ),
};
