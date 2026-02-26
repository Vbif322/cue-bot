import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { matchesApi } from "../lib/api.ts";
import { MatchStatusBadge } from "../components/StatusBadge.tsx";

export default function MatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [error, setError] = useState("");
  const [techReason, setTechReason] = useState("");
  const [techWinnerId, setTechWinnerId] = useState("");
  const [p1Score, setP1Score] = useState(0);
  const [p2Score, setP2Score] = useState(0);

  const { data: match, isLoading } = useQuery({
    queryKey: ["match", id],
    queryFn: () => matchesApi.get(id!),
    enabled: !!id,
    refetchInterval: 15_000,
  });

  console.log(match);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["match", id] });
    setError("");
  };

  const startMutation = useMutation({
    mutationFn: () => matchesApi.start(id!),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  });

  const reportMutation = useMutation({
    mutationFn: () =>
      matchesApi.report(id!, {
        reporterId: match!.player1Id!,
        player1Score: p1Score,
        player2Score: p2Score,
      }),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  });

  const confirmMutation = useMutation({
    mutationFn: () => matchesApi.confirm(id!, match!.player2Id!),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  });

  const disputeMutation = useMutation({
    mutationFn: () => matchesApi.dispute(id!, match!.player2Id!),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  });

  const techMutation = useMutation({
    mutationFn: () => matchesApi.setTechnical(id!, techWinnerId, techReason),
    onSuccess: () => {
      invalidate();
      setTechReason("");
      setTechWinnerId("");
    },
    onError: (e: Error) => setError(e.message),
  });

  if (isLoading || !match) {
    return <div className="text-gray-500 text-sm">Загрузка...</div>;
  }

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link
          to={`/tournaments/${match.tournamentId}`}
          className="hover:text-gray-700"
        >
          Турнир
        </Link>
        <span>/</span>
        <span>
          Матч R{match.round} #{match.position}
        </span>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-200">
          {error}
        </div>
      )}

      {/* Match card */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <MatchStatusBadge status={match.status} />
          {match.isTechnicalResult && (
            <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded">
              Технический результат: {match.technicalReason}
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-4 items-center">
          <div className="text-center">
            <p className="font-semibold text-gray-900">
              {match.player1Name ?? match.player1Username ?? "TBD"}
            </p>
            {match.player1Username && (
              <p className="text-xs text-gray-500">@{match.player1Username}</p>
            )}
          </div>

          <div className="text-center">
            {match.player1Score !== null && match.player2Score !== null ? (
              <p className="text-3xl font-bold text-gray-900">
                {match.player1Score} : {match.player2Score}
              </p>
            ) : (
              <p className="text-gray-400 text-sm">vs</p>
            )}
          </div>

          <div className="text-center">
            <p className="font-semibold text-gray-900">
              {match.player2Name ?? match.player2Username ?? "TBD"}
            </p>
            {match.player2Username && (
              <p className="text-xs text-gray-500">@{match.player2Username}</p>
            )}
          </div>
        </div>

        {match.winnerId && (
          <p className="text-center text-sm text-green-600 mt-4">
            Победитель:{" "}
            {match.winnerUsername ? `@${match.winnerUsername}` : match.winnerId}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="space-y-4">
        {/* Start match */}
        {match.status === "scheduled" && match.player1Id && match.player2Id && (
          <ActionCard title="Начать матч">
            <button
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              Начать
            </button>
          </ActionCard>
        )}

        {/* Report result */}
        {match.status === "in_progress" &&
          match.player1Id &&
          match.player2Id && (
            <ActionCard title="Внести результат">
              <div className="flex items-center gap-3">
                <div className="text-center">
                  <p className="text-xs text-gray-500 mb-1">
                    {match.player1Name ?? match.player1Username}
                  </p>
                  <input
                    type="number"
                    min={0}
                    value={p1Score}
                    onChange={(e) => setP1Score(Number(e.target.value))}
                    className="w-16 px-2 py-1 border border-gray-300 rounded text-center text-sm"
                  />
                </div>
                <span className="text-gray-400">:</span>
                <div className="text-center">
                  <p className="text-xs text-gray-500 mb-1">
                    {match.player2Name ?? match.player2Username}
                  </p>
                  <input
                    type="number"
                    min={0}
                    value={p2Score}
                    onChange={(e) => setP2Score(Number(e.target.value))}
                    className="w-16 px-2 py-1 border border-gray-300 rounded text-center text-sm"
                  />
                </div>
                <button
                  onClick={() => reportMutation.mutate()}
                  disabled={reportMutation.isPending}
                  className="ml-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  Подать
                </button>
              </div>
            </ActionCard>
          )}

        {/* Confirm/dispute */}
        {match.status === "pending_confirmation" && (
          <ActionCard title="Подтверждение результата">
            <div className="flex gap-2">
              <button
                onClick={() => confirmMutation.mutate()}
                disabled={confirmMutation.isPending}
                className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                Подтвердить
              </button>
              <button
                onClick={() => disputeMutation.mutate()}
                disabled={disputeMutation.isPending}
                className="px-4 py-2 border border-red-300 text-red-600 text-sm rounded-lg hover:bg-red-50 disabled:opacity-50"
              >
                Оспорить
              </button>
            </div>
          </ActionCard>
        )}

        {/* Technical result */}
        {match.status !== "completed" &&
          match.status !== "cancelled" &&
          match.player1Id &&
          match.player2Id && (
            <ActionCard title="Технический результат">
              <div className="space-y-2">
                <select
                  value={techWinnerId}
                  onChange={(e) => setTechWinnerId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  <option value="">Выберите победителя</option>
                  <option value={match.player1Id}>
                    {match.player1Name ?? match.player1Username}
                  </option>
                  <option value={match.player2Id}>
                    {match.player2Name ?? match.player2Username}
                  </option>
                </select>
                <input
                  value={techReason}
                  onChange={(e) => setTechReason(e.target.value)}
                  placeholder="Причина (no_show, walkover, forfeit...)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
                <button
                  onClick={() => techMutation.mutate()}
                  disabled={
                    techMutation.isPending || !techWinnerId || !techReason
                  }
                  className="px-4 py-2 bg-orange-600 text-white text-sm rounded-lg hover:bg-orange-700 disabled:opacity-50"
                >
                  Применить
                </button>
              </div>
            </ActionCard>
          )}
      </div>
    </div>
  );
}

function ActionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">{title}</h3>
      {children}
    </div>
  );
}
