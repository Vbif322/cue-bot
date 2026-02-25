import type { TournamentStatus } from "../lib/api.ts";

type MatchStatus = "scheduled" | "in_progress" | "pending_confirmation" | "completed" | "cancelled";

const TOURNAMENT_LABELS: Record<TournamentStatus, string> = {
  draft: "Черновик",
  registration_open: "Регистрация",
  registration_closed: "Рег. закрыта",
  in_progress: "Идёт",
  completed: "Завершён",
  cancelled: "Отменён",
};

const TOURNAMENT_COLORS: Record<TournamentStatus, string> = {
  draft: "bg-gray-100 text-gray-700",
  registration_open: "bg-green-100 text-green-700",
  registration_closed: "bg-yellow-100 text-yellow-700",
  in_progress: "bg-blue-100 text-blue-700",
  completed: "bg-purple-100 text-purple-700",
  cancelled: "bg-red-100 text-red-700",
};

const MATCH_LABELS: Record<MatchStatus, string> = {
  scheduled: "Запланирован",
  in_progress: "Идёт",
  pending_confirmation: "Ожидает подтверждения",
  completed: "Завершён",
  cancelled: "Отменён",
};

const MATCH_COLORS: Record<MatchStatus, string> = {
  scheduled: "bg-gray-100 text-gray-700",
  in_progress: "bg-blue-100 text-blue-700",
  pending_confirmation: "bg-yellow-100 text-yellow-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
};

export function TournamentStatusBadge({ status }: { status: TournamentStatus }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${TOURNAMENT_COLORS[status]}`}
    >
      {TOURNAMENT_LABELS[status]}
    </span>
  );
}

export function MatchStatusBadge({ status }: { status: MatchStatus }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${MATCH_COLORS[status]}`}
    >
      {MATCH_LABELS[status]}
    </span>
  );
}
