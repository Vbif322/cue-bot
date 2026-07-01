import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { matchesApi, tournamentsApi } from '../lib/api.ts';
import type { ApiTable, ApiMatch } from '../lib/api.ts';
import { MatchStatusBadge } from '@cue-bot/ui';
import { formatUtc, isoToUtcInput, utcInputToIso } from '../lib/datetime.ts';

export default function MatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [techReason, setTechReason] = useState('');
  const [techWinnerId, setTechWinnerId] = useState('');
  const [p1Score, setP1Score] = useState(0);
  const [p2Score, setP2Score] = useState(0);
  const [p1Focused, setP1Focused] = useState(false);
  const [p2Focused, setP2Focused] = useState(false);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [scheduleInput, setScheduleInput] = useState('');
  const [reporterId, setReporterId] = useState<string | null>(null);
  const [corrP1, setCorrP1] = useState(0);
  const [corrP2, setCorrP2] = useState(0);
  const [corrP1Focused, setCorrP1Focused] = useState(false);
  const [corrP2Focused, setCorrP2Focused] = useState(false);
  const [corrReason, setCorrReason] = useState('');
  const [corrPreview, setCorrPreview] = useState<Awaited<
    ReturnType<typeof matchesApi.previewCorrection>
  > | null>(null);
  const [corrSuccess, setCorrSuccess] = useState('');

  const { data: match, isLoading } = useQuery({
    queryKey: ['match', id],
    queryFn: () => matchesApi.get(id!),
    enabled: !!id,
    refetchInterval: 15_000,
  });

  const { data: tournamentTables } = useQuery<ApiTable[]>({
    queryKey: ['tournament-tables', match?.tournamentId],
    queryFn: () => tournamentsApi.tables(match!.tournamentId),
    enabled: !!match?.tournamentId,
  });

  const { data: tournamentMatches } = useQuery<ApiMatch[]>({
    queryKey: ['tournament-matches', match?.tournamentId],
    queryFn: () => matchesApi.byTournament(match!.tournamentId),
    enabled: !!match?.tournamentId,
  });

  const { data: tournament } = useQuery({
    queryKey: ['tournament', match?.tournamentId],
    queryFn: () => tournamentsApi.get(match!.tournamentId),
    enabled: !!match?.tournamentId,
  });

  useEffect(() => {
    setSelectedTableId(match?.tableId ?? null);
  }, [match?.tableId]);

  useEffect(() => {
    setScheduleInput(isoToUtcInput(match?.scheduledAt ?? null));
  }, [match?.scheduledAt]);

  useEffect(() => {
    setReporterId(match?.player1Id ?? null);
  }, [match?.player1Id, match?.id]);

  useEffect(() => {
    setCorrP1(match?.player1Score ?? 0);
    setCorrP2(match?.player2Score ?? 0);
    setCorrPreview(null);
  }, [match?.player1Score, match?.player2Score, match?.id]);

  // Map of tables currently held by some OTHER in-progress match in this tournament.
  const busyByTable = useMemo(() => {
    const m = new Map<string, { round: number; position: number }>();
    if (!tournamentMatches) return m;
    for (const tm of tournamentMatches) {
      if (tm.tableId && tm.status === 'in_progress' && tm.id !== match?.id) {
        m.set(tm.tableId, { round: tm.round, position: tm.position });
      }
    }
    return m;
  }, [tournamentMatches, match?.id]);

  // Options: tournament tables + current table (if unlinked from tournament).
  const tableOptions = useMemo(() => {
    const list: { id: string; label: string; orphaned: boolean }[] = [];
    const seen = new Set<string>();
    for (const t of tournamentTables ?? []) {
      list.push({ id: t.id, label: t.name, orphaned: false });
      seen.add(t.id);
    }
    if (match?.tableId && !seen.has(match.tableId)) {
      list.push({
        id: match.tableId,
        label: `${match.tableName ?? 'Стол'} (удалён из турнира)`,
        orphaned: true,
      });
    }
    return list;
  }, [tournamentTables, match?.tableId, match?.tableName]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['match', id] });
    if (match?.tournamentId) {
      qc.invalidateQueries({
        queryKey: ['tournament-matches', match.tournamentId],
      });
    }
    setError('');
  };

  const startMutation = useMutation({
    mutationFn: () => matchesApi.start(id!),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  });

  const reportMutation = useMutation({
    mutationFn: () =>
      matchesApi.report(id!, {
        reporterId: reporterId!,
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
      setTechReason('');
      setTechWinnerId('');
    },
    onError: (e: Error) => setError(e.message),
  });

  const setTableMutation = useMutation({
    mutationFn: () => matchesApi.setTable(id!, selectedTableId),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  });

  const setScheduleMutation = useMutation({
    mutationFn: (scheduledAt: string | null) =>
      matchesApi.setSchedule(id!, scheduledAt),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  });

  const previewMutation = useMutation({
    mutationFn: () =>
      matchesApi.previewCorrection(id!, {
        player1Score: corrP1,
        player2Score: corrP2,
      }),
    onSuccess: (data) => {
      if (!data.valid) {
        setError(data.error ?? 'Некорректный счёт');
        setCorrPreview(null);
        return;
      }
      setError('');
      setCorrSuccess('');
      setCorrPreview(data);
    },
    onError: (e: Error) => setError(e.message),
  });

  const correctMutation = useMutation({
    mutationFn: () =>
      matchesApi.correct(id!, {
        player1Score: corrP1,
        player2Score: corrP2,
        reason: corrReason,
      }),
    onSuccess: (data) => {
      invalidate();
      setCorrPreview(null);
      setCorrReason('');
      setCorrSuccess(
        data.winnerChanged
          ? `Результат исправлен. Сброшено матчей: ${data.affectedCount}.${
              data.warning ? ` ${data.warning}` : ''
            }`
          : 'Счёт исправлен.',
      );
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
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <MatchStatusBadge status={match.status} />
          {match.tableName && (
            <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded font-medium">
              {match.tableName}
            </span>
          )}
          {match.scheduledAt && (
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-medium">
              🗓 {formatUtc(match.scheduledAt)}
            </span>
          )}
          {match.isTechnicalResult && (
            <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded">
              Технический результат: {match.technicalReason}
            </span>
          )}
          {match.isCorrected && (
            <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">
              Результат скорректирован
              {match.correctionReason ? `: ${match.correctionReason}` : ''}
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-4 items-center">
          <div className="text-center min-w-0">
            <p className="font-semibold text-gray-900 truncate">
              {match.player1Name ?? match.player1Username ?? 'TBD'}
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

          <div className="text-center min-w-0">
            <p className="font-semibold text-gray-900 truncate">
              {match.player2Name ?? match.player2Username ?? 'TBD'}
            </p>
            {match.player2Username && (
              <p className="text-xs text-gray-500">@{match.player2Username}</p>
            )}
          </div>
        </div>

        {match.winnerId && (
          <p className="text-center text-sm text-green-600 mt-4">
            Победитель:{' '}
            {match.winnerUsername ? `@${match.winnerUsername}` : match.winnerId}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="space-y-4">
        {/* Start match */}
        {match.status === 'scheduled' && match.player1Id && match.player2Id && (
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
        {match.status === 'in_progress' &&
          match.player1Id &&
          match.player2Id && (
            <ActionCard title="Внести результат">
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-gray-500 mb-1">От лица</p>
                  <select
                    value={reporterId ?? ''}
                    onChange={(e) => setReporterId(e.target.value || null)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    <option value={match.player1Id}>
                      {match.player1Name ?? match.player1Username}
                    </option>
                    <option value={match.player2Id}>
                      {match.player2Name ?? match.player2Username}
                    </option>
                  </select>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="text-center">
                    <p className="text-xs text-gray-500 mb-1">
                      {match.player1Name ?? match.player1Username}
                    </p>
                    <input
                      type="number"
                      min={0}
                      value={p1Focused && p1Score === 0 ? '' : p1Score}
                      onFocus={() => setP1Focused(true)}
                      onBlur={() => setP1Focused(false)}
                      onChange={(e) => setP1Score(Number(e.target.value) || 0)}
                      className="w-16 px-2 py-1 border border-gray-300 rounded text-center text-sm"
                    />
                  </div>
                  <span className="text-gray-400 pb-1">:</span>
                  <div className="text-center">
                    <p className="text-xs text-gray-500 mb-1">
                      {match.player2Name ?? match.player2Username}
                    </p>
                    <input
                      type="number"
                      min={0}
                      value={p2Focused && p2Score === 0 ? '' : p2Score}
                      onFocus={() => setP2Focused(true)}
                      onBlur={() => setP2Focused(false)}
                      onChange={(e) => setP2Score(Number(e.target.value) || 0)}
                      className="w-16 px-2 py-1 border border-gray-300 rounded text-center text-sm"
                    />
                  </div>
                  <button
                    onClick={() => reportMutation.mutate()}
                    disabled={reportMutation.isPending || !reporterId}
                    className="ml-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    Подать
                  </button>
                </div>
              </div>
            </ActionCard>
          )}

        {/* Confirm/dispute */}
        {match.status === 'pending_confirmation' && (
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
        {match.status !== 'completed' &&
          match.status !== 'cancelled' &&
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

        {/* Table assignment */}
        <ActionCard title="Стол">
          {tableOptions.length === 0 ? (
            <p className="text-sm text-gray-500">
              У турнира нет столов. Добавьте их в настройках турнира.
            </p>
          ) : (
            (() => {
              const busy = selectedTableId
                ? busyByTable.get(selectedTableId)
                : undefined;
              const unchanged = selectedTableId === (match.tableId ?? null);
              return (
                <div className="space-y-2">
                  <select
                    value={selectedTableId ?? ''}
                    onChange={(e) => setSelectedTableId(e.target.value || null)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    <option value="">— Без стола —</option>
                    {tableOptions.map((opt) => {
                      const b = busyByTable.get(opt.id);
                      const suffix = b
                        ? ` (занят: R${b.round} #${b.position})`
                        : '';
                      return (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                          {suffix}
                        </option>
                      );
                    })}
                  </select>
                  {/** TODO не показывать уведомление у завершенных матчей */}
                  {busy && (
                    <p className="text-xs text-orange-600">
                      Этот стол занят матчем R{busy.round} #{busy.position}.
                      Назначение освободит его.
                    </p>
                  )}
                  <button
                    onClick={() => setTableMutation.mutate()}
                    disabled={setTableMutation.isPending || unchanged}
                    className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    Сохранить
                  </button>
                </div>
              );
            })()
          )}
        </ActionCard>

        {/* Per-match scheduling */}
        {tournament?.scheduleMode === 'per_match' &&
          match.status !== 'completed' &&
          match.status !== 'cancelled' && (
            <ActionCard title="Время матча">
              <div className="space-y-2">
                <input
                  type="datetime-local"
                  value={scheduleInput}
                  onChange={(e) => setScheduleInput(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
                <p className="text-xs text-gray-400">
                  Время указывается и отображается в UTC (как в боте).
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() =>
                      setScheduleMutation.mutate(utcInputToIso(scheduleInput))
                    }
                    disabled={setScheduleMutation.isPending || !scheduleInput}
                    className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    Назначить
                  </button>
                  {match.scheduledAt && (
                    <button
                      onClick={() => setScheduleMutation.mutate(null)}
                      disabled={setScheduleMutation.isPending}
                      className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50"
                    >
                      Сбросить
                    </button>
                  )}
                </div>
              </div>
            </ActionCard>
          )}

        {/* Correct completed result */}
        {match.status === 'completed' && match.player1Id && match.player2Id && (
          <ActionCard title="Скорректировать результат">
            <div className="space-y-3">
              <div className="p-3 bg-orange-50 text-orange-700 text-sm rounded-lg border border-orange-200">
                Изменение счёта может сбросить пары последующих матчей — их
                нужно будет переиграть.
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="text-center">
                  <p className="text-xs text-gray-500 mb-1">
                    {match.player1Name ?? match.player1Username}
                  </p>
                  <input
                    type="number"
                    min={0}
                    value={corrP1Focused && corrP1 === 0 ? '' : corrP1}
                    onFocus={() => setCorrP1Focused(true)}
                    onBlur={() => setCorrP1Focused(false)}
                    onChange={(e) => {
                      setCorrP1(Number(e.target.value) || 0);
                      setCorrPreview(null);
                    }}
                    className="w-16 px-2 py-1 border border-gray-300 rounded text-center text-sm"
                  />
                </div>
                <span className="text-gray-400 pb-1">:</span>
                <div className="text-center">
                  <p className="text-xs text-gray-500 mb-1">
                    {match.player2Name ?? match.player2Username}
                  </p>
                  <input
                    type="number"
                    min={0}
                    value={corrP2Focused && corrP2 === 0 ? '' : corrP2}
                    onFocus={() => setCorrP2Focused(true)}
                    onBlur={() => setCorrP2Focused(false)}
                    onChange={(e) => {
                      setCorrP2(Number(e.target.value) || 0);
                      setCorrPreview(null);
                    }}
                    className="w-16 px-2 py-1 border border-gray-300 rounded text-center text-sm"
                  />
                </div>
              </div>
              <input
                value={corrReason}
                onChange={(e) => setCorrReason(e.target.value)}
                placeholder="Причина исправления"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />

              {corrPreview ? (
                <div className="space-y-2">
                  <div className="p-3 bg-amber-50 text-amber-800 text-sm rounded-lg border border-amber-200 space-y-1">
                    {corrPreview.winnerChanged ? (
                      <p>
                        Победитель изменится. Будет сброшено матчей:{' '}
                        <b>{corrPreview.affectedCount}</b> — их нужно
                        переиграть.
                      </p>
                    ) : (
                      <p>Победитель не меняется — изменится только счёт.</p>
                    )}
                    {corrPreview.tournamentWillReopen && (
                      <p>Турнир будет возобновлён.</p>
                    )}
                    {corrPreview.willReshuffle && (
                      <p>
                        Внимание: в формате со случайной сеткой пары последующих
                        матчей будут перетасованы заново.
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => correctMutation.mutate()}
                      disabled={correctMutation.isPending}
                      className="px-4 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 disabled:opacity-50"
                    >
                      Подтвердить
                    </button>
                    <button
                      onClick={() => setCorrPreview(null)}
                      disabled={correctMutation.isPending}
                      className="px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50"
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => previewMutation.mutate()}
                  disabled={previewMutation.isPending || !corrReason}
                  className="px-4 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 disabled:opacity-50"
                >
                  Исправить результат
                </button>
              )}

              {corrSuccess && (
                <div className="p-3 bg-green-50 text-green-700 text-sm rounded-lg border border-green-200">
                  {corrSuccess}
                </div>
              )}
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
