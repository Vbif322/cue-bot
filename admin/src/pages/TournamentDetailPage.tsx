import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { tournamentsApi, matchesApi } from "../lib/api.ts";
import type { ApiTable } from "../lib/api.ts";
import {
  TournamentStatusBadge,
  MatchStatusBadge,
} from "../components/StatusBadge.tsx";
import type { TournamentStatus } from "../lib/api.ts";

const FORMAT_LABELS = {
  single_elimination: "Single Elimination",
  double_elimination: "Double Elimination",
  round_robin: "Round Robin",
};

const NEXT_STATUS: Partial<Record<TournamentStatus, TournamentStatus>> = {
  draft: "registration_open",
  registration_open: "registration_closed",
  registration_closed: "in_progress",
};

const STATUS_ACTION_LABELS: Partial<Record<TournamentStatus, string>> = {
  draft: "Открыть регистрацию",
  registration_open: "Закрыть регистрацию",
  registration_closed: "Запустить турнир",
};

export default function TournamentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<
    "info" | "participants" | "matches"
  >("info");
  const [actionError, setActionError] = useState("");

  const { data: tournament, isLoading } = useQuery({
    queryKey: ["tournament", id],
    queryFn: () => tournamentsApi.get(id!),
    enabled: !!id,
  });

  const { data: participants } = useQuery({
    queryKey: ["tournament-participants", id],
    queryFn: () => tournamentsApi.participants(id!),
    enabled: !!id && activeTab === "participants",
  });

  const { data: matches } = useQuery({
    queryKey: ["tournament-matches", id],
    queryFn: () => matchesApi.byTournament(id!),
    enabled: !!id && activeTab === "matches",
  });

  const { data: tournamentTables } = useQuery<ApiTable[]>({
    queryKey: ["tournament-tables", id],
    queryFn: () => tournamentsApi.tables(id!),
    enabled: !!id,
  });
  const statusMutation = useMutation({
    mutationFn: (status: TournamentStatus) =>
      tournamentsApi.setStatus(id!, status),
    onSuccess: () => {
      setActionError("");
      qc.invalidateQueries({ queryKey: ["tournament", id] });
      qc.invalidateQueries({ queryKey: ["tournaments"] });
    },
    onError: (e: Error) => setActionError(e.message),
  });

  const startMutation = useMutation({
    mutationFn: () => tournamentsApi.start(id!),
    onSuccess: () => {
      setActionError("");
      qc.invalidateQueries({ queryKey: ["tournament", id] });
      qc.invalidateQueries({ queryKey: ["tournaments"] });
      qc.invalidateQueries({ queryKey: ["tournament-matches", id] });
    },
    onError: (e: Error) => setActionError(e.message),
  });

  const confirmParticipantMutation = useMutation({
    mutationFn: (userId: string) =>
      tournamentsApi.confirmParticipant(id!, userId),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["tournament-participants", id] }),
    onError: (e: Error) => setActionError(e.message),
  });

  const rejectParticipantMutation = useMutation({
    mutationFn: (userId: string) =>
      tournamentsApi.rejectParticipant(id!, userId),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["tournament-participants", id] }),
    onError: (e: Error) => setActionError(e.message),
  });

  const handleNextAction = () => {
    if (!tournament) return;
    const next = NEXT_STATUS[tournament.status];
    if (!next) return;

    if (next === "in_progress") {
      if (
        !confirm("Запустить турнир? Это создаст сетку и уведомит участников.")
      )
        return;
      startMutation.mutate();
    } else {
      statusMutation.mutate(next);
    }
  };

  if (isLoading || !tournament) {
    return <div className="text-gray-500 text-sm">Загрузка...</div>;
  }

  const nextStatus = NEXT_STATUS[tournament.status];
  const nextLabel = STATUS_ACTION_LABELS[tournament.status];

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col gap-3 mb-6 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Link to="/tournaments" className="hover:text-gray-700">
              Турниры
            </Link>
            <span>/</span>
            <span>{tournament.name}</span>
          </div>
          <h2 className="text-xl font-semibold text-gray-900">
            {tournament.name}
          </h2>
          <div className="flex items-center gap-3 mt-2">
            <TournamentStatusBadge status={tournament.status} />
            <span className="text-sm text-gray-500">
              {FORMAT_LABELS[tournament.format]}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {nextStatus && nextLabel && (
            <button
              onClick={handleNextAction}
              disabled={statusMutation.isPending || startMutation.isPending}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {statusMutation.isPending || startMutation.isPending
                ? "Обработка..."
                : nextLabel}
            </button>
          )}
          {tournament.status === "in_progress" && (
            <button
              onClick={() => {
                if (confirm("Отменить турнир?"))
                  statusMutation.mutate("cancelled");
              }}
              className="px-4 py-2 border border-red-300 text-red-600 text-sm rounded-lg hover:bg-red-50"
            >
              Отменить
            </button>
          )}
        </div>
      </div>

      {actionError && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-200">
          {actionError}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {(["info", "participants", "matches"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-600 hover:text-gray-900"
            }`}
          >
            {tab === "info" && "Информация"}
            {tab === "participants" && "Участники"}
            {tab === "matches" && "Матчи"}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "info" && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <InfoRow
            label="Статус"
            value={<TournamentStatusBadge status={tournament.status} />}
          />
          <InfoRow label="Формат" value={FORMAT_LABELS[tournament.format]} />
          <InfoRow
            label="Участники"
            value={`${tournament.confirmedParticipants ?? 0} / ${tournament.maxParticipants}`}
          />
          <InfoRow label="Win score" value={String(tournament.winScore)} />
          {tournament.startDate && (
            <InfoRow
              label="Дата начала"
              value={new Date(tournament.startDate).toLocaleString("ru-RU")}
            />
          )}
          <InfoRow
            label="Столы"
            value={
              tournamentTables && tournamentTables.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {tournamentTables.map((t) => (
                    <span
                      key={t.id}
                      className="px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded-full"
                    >
                      {t.name}
                    </span>
                  ))}
                </div>
              ) : (
                "—"
              )
            }
          />
          {tournament.description && (
            <InfoRow label="Описание" value={tournament.description} />
          )}
          {tournament.rules && (
            <InfoRow label="Правила" value={tournament.rules} />
          )}
        </div>
      )}

      {activeTab === "participants" && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600">
                  Сид
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">
                  Игрок
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">
                  Статус
                </th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {participants?.map((p) => (
                <tr key={p.userId}>
                  <td className="px-4 py-3 text-gray-500">{p.seed ?? "—"}</td>
                  <td className="px-4 py-3 font-medium">
                    {p.name ?? p.username ?? p.userId}
                    {p.username && (
                      <span className="text-gray-400 font-normal ml-1">
                        @{p.username}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <ParticipantStatusBadge status={p.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {p.status === "pending" &&
                      (tournament.status === "registration_open" ||
                        tournament.status === "registration_closed") && (
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() =>
                              confirmParticipantMutation.mutate(p.userId)
                            }
                            disabled={
                              (confirmParticipantMutation.isPending &&
                                confirmParticipantMutation.variables ===
                                  p.userId) ||
                              (rejectParticipantMutation.isPending &&
                                rejectParticipantMutation.variables === p.userId)
                            }
                            className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                          >
                            Подтвердить
                          </button>
                          <button
                            onClick={() =>
                              rejectParticipantMutation.mutate(p.userId)
                            }
                            disabled={
                              (confirmParticipantMutation.isPending &&
                                confirmParticipantMutation.variables ===
                                  p.userId) ||
                              (rejectParticipantMutation.isPending &&
                                rejectParticipantMutation.variables === p.userId)
                            }
                            className="px-2 py-1 text-xs border border-red-300 text-red-600 rounded hover:bg-red-50 disabled:opacity-50"
                          >
                            Отклонить
                          </button>
                        </div>
                      )}
                  </td>
                </tr>
              ))}
              {!participants?.length && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-6 text-center text-gray-400"
                  >
                    Нет участников
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "matches" && (
        <>
          {/* Mobile match cards */}
          <div className="md:hidden space-y-3">
            {!matches?.length && (
              <div className="text-center text-gray-400 py-8 text-sm">
                Матчи не созданы
              </div>
            )}
            {matches?.map((m) => (
              <div
                key={m.id}
                className="bg-white rounded-xl border border-gray-200 p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 font-medium">
                      R{m.round}
                      {m.bracketType === "losers" && (
                        <span className="text-orange-500 ml-1">L</span>
                      )}
                    </span>
                    {m.tableName && (
                      <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">
                        {m.tableName}
                      </span>
                    )}
                  </div>
                  <MatchStatusBadge status={m.status} />
                </div>
                <div className="flex items-center justify-center gap-3 my-3">
                  <span className="font-medium text-gray-900 text-sm text-right flex-1">
                    {m.player1Name ?? m.player1Username ?? "TBD"}
                  </span>
                  <span className="font-mono text-gray-700 text-sm px-2">
                    {m.player1Score !== null && m.player2Score !== null
                      ? `${m.player1Score}:${m.player2Score}`
                      : "vs"}
                  </span>
                  <span className="font-medium text-gray-900 text-sm text-left flex-1">
                    {m.player2Name ?? m.player2Username ?? "TBD"}
                  </span>
                </div>
                <div className="text-right">
                  <Link
                    to={`/matches/${m.id}`}
                    className="text-blue-500 text-xs"
                  >
                    Управление
                  </Link>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop matches table */}
          <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Раунд
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Игрок 1
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Счёт
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Игрок 2
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Стол
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Статус
                  </th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {matches?.map((m) => (
                  <tr key={m.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-500">
                      R{m.round}
                      {m.bracketType === "losers" && (
                        <span className="ml-1 text-xs text-orange-500">L</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {m.player1Name ?? m.player1Username ?? "TBD"}
                    </td>
                    <td className="px-4 py-3 font-mono text-center">
                      {m.player1Score !== null && m.player2Score !== null
                        ? `${m.player1Score}:${m.player2Score}`
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {m.player2Name ?? m.player2Username ?? "TBD"}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {m.tableName ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <MatchStatusBadge status={m.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/matches/${m.id}`}
                        className="text-blue-500 hover:text-blue-700 text-xs"
                      >
                        Управление
                      </Link>
                    </td>
                  </tr>
                ))}
                {!matches?.length && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-6 text-center text-gray-400"
                    >
                      Матчи не созданы
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function ParticipantStatusBadge({ status }: { status: string }) {
  if (status === "confirmed")
    return (
      <span className="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-700">
        Подтверждён
      </span>
    );
  if (status === "pending")
    return (
      <span className="px-2 py-0.5 text-xs rounded-full bg-yellow-100 text-yellow-700">
        Ожидает
      </span>
    );
  if (status === "cancelled")
    return (
      <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-500">
        Отменён
      </span>
    );
  return <span className="text-xs text-gray-500">{status}</span>;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <span className="text-sm text-gray-500 w-36 shrink-0">{label}</span>
      <span className="text-sm text-gray-900">{value}</span>
    </div>
  );
}
