import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { tournamentsApi } from "../lib/api.ts";
import { TournamentStatusBadge } from "../components/StatusBadge.tsx";
import type { TournamentStatus } from "../lib/api.ts";
import CreateTournamentModal from "../components/CreateTournamentModal.tsx";

const FORMAT_LABELS = {
  single_elimination: "Single Elim.",
  double_elimination: "Double Elim.",
  round_robin: "Round Robin",
};

export default function TournamentsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<TournamentStatus | "all">("all");
  const [showCreate, setShowCreate] = useState(false);

  const { data: tournaments, isLoading } = useQuery({
    queryKey: ["tournaments"],
    queryFn: tournamentsApi.list,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => tournamentsApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tournaments"] }),
  });

  const filtered = tournaments?.filter(
    (t) => filter === "all" || t.status === filter,
  );

  const STATUS_FILTERS: { value: TournamentStatus | "all"; label: string }[] = [
    { value: "all", label: "Все" },
    { value: "draft", label: "Черновики" },
    { value: "registration_open", label: "Регистрация" },
    { value: "registration_closed", label: "Рег. закрыта" },
    { value: "in_progress", label: "Идут" },
    { value: "completed", label: "Завершены" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Турниры</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          + Новый турнир
        </button>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 p-1 rounded-lg overflow-x-auto">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`shrink-0 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              filter === f.value
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-gray-500 text-sm">Загрузка...</div>
      ) : (
        <>
          {/* Mobile card list */}
          <div className="md:hidden space-y-3">
            {filtered?.length === 0 && (
              <div className="text-center text-gray-400 py-8 text-sm">
                Турниры не найдены
              </div>
            )}
            {filtered?.map((t) => (
              <div
                key={t.id}
                className="bg-white rounded-xl border border-gray-200 p-4"
              >
                <div className="flex items-start justify-between mb-2">
                  <Link
                    to={`/tournaments/${t.id}`}
                    className="font-medium text-blue-600 hover:text-blue-800 text-sm leading-snug"
                  >
                    {t.name}
                  </Link>
                  <TournamentStatusBadge status={t.status} />
                </div>
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Формат</dt>
                    <dd className="text-gray-700">{FORMAT_LABELS[t.format]}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Участники</dt>
                    <dd className="text-gray-700">
                      {t.confirmedParticipants ?? 0} / {t.maxParticipants}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Дата начала</dt>
                    <dd className="text-gray-700">
                      {t.startDate
                        ? new Date(t.startDate).toLocaleDateString("ru-RU")
                        : "—"}
                    </dd>
                  </div>
                </dl>
                <div className="flex gap-3 mt-3 pt-3 border-t border-gray-100">
                  <Link
                    to={`/tournaments/${t.id}`}
                    className="text-blue-500 text-xs"
                  >
                    Детали
                  </Link>
                  {(t.status === "draft" || t.status === "cancelled") && (
                    <button
                      onClick={() => {
                        if (confirm(`Удалить турнир "${t.name}"?`))
                          deleteMutation.mutate(t.id);
                      }}
                      className="text-red-500 text-xs"
                    >
                      Удалить
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Название
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Формат
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Статус
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Участники
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Дата начала
                  </th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered?.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-center text-gray-400"
                    >
                      Турниры не найдены
                    </td>
                  </tr>
                )}
                {filtered?.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <Link
                        to={`/tournaments/${t.id}`}
                        className="font-medium text-blue-600 hover:text-blue-800"
                      >
                        {t.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {FORMAT_LABELS[t.format]}
                    </td>
                    <td className="px-4 py-3">
                      <TournamentStatusBadge status={t.status} />
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {t.confirmedParticipants ?? 0} / {t.maxParticipants}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {t.startDate
                        ? new Date(t.startDate).toLocaleDateString("ru-RU")
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/tournaments/${t.id}`}
                        className="text-gray-500 hover:text-gray-700 text-xs mr-3"
                      >
                        Детали
                      </Link>
                      {(t.status === "draft" || t.status === "cancelled") && (
                        <button
                          onClick={() => {
                            if (confirm(`Удалить турнир "${t.name}"?`))
                              deleteMutation.mutate(t.id);
                          }}
                          className="text-red-500 hover:text-red-700 text-xs"
                        >
                          Удалить
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showCreate && (
        <CreateTournamentModal onClose={() => setShowCreate(false)} />
      )}
    </div>
  );
}
