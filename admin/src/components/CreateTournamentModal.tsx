import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { tournamentsApi, tablesApi, venuesApi } from '../lib/api.ts';
import {
  formats,
  maxParticipants,
  validMergeRoundsForSize,
  winScores,
} from '@server/apiTypes';
import type {
  ApiTournament,
  ITournamentFormat,
  TournamentVisibility,
  TournamentScheduleMode,
} from '../lib/api.ts';
import {
  FORMAT_LABELS,
  VISIBILITY_LABELS,
  SCHEDULE_MODE_LABELS,
} from '../lib/tournamentLabels.ts';

type Mode = { mode: 'create' } | { mode: 'edit'; tournament: ApiTournament };

// Build a datetime-local value (YYYY-MM-DDTHH:mm) from an ISO string using local
// time parts, so the pre-filled value matches the wall-clock that create stored.
function toLocalDatetimeInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function TournamentFormModal({
  onClose,
  ...modeProps
}: { onClose: () => void } & Mode) {
  const qc = useQueryClient();
  const tournament =
    modeProps.mode === 'edit' ? modeProps.tournament : undefined;
  const isEdit = tournament !== undefined;

  const [form, setForm] = useState({
    name: tournament?.name ?? '',
    description: tournament?.description ?? '',
    rules: tournament?.rules ?? '',
    format: (tournament?.format ?? 'single_elimination') as ITournamentFormat,
    randomAdvancement: tournament?.randomAdvancement ?? false,
    visibility: (tournament?.visibility ?? 'public') as TournamentVisibility,
    scheduleMode: (tournament?.scheduleMode ??
      'single_day') as TournamentScheduleMode,
    maxParticipants: (tournament?.maxParticipants ?? 16) as number,
    winScore: (tournament?.winScore ?? 2) as number,
    mergeRound: (tournament?.mergeRound ?? 2) as number,
    startDate: tournament?.startDate
      ? toLocalDatetimeInput(tournament.startDate)
      : '',
    venueId: tournament?.venueId ?? '',
  });
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>([]);
  const [error, setError] = useState('');

  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn: () => venuesApi.list(),
  });

  const { data: existingTables = [] } = useQuery({
    queryKey: ['tables'],
    queryFn: () => tablesApi.list(),
  });

  // Pre-select the tables currently assigned to the tournament (edit mode only).
  const { data: assignedTables } = useQuery({
    queryKey: ['tournament-tables', tournament?.id],
    queryFn: () => tournamentsApi.tables(tournament!.id),
    enabled: isEdit,
  });

  useEffect(() => {
    if (assignedTables) {
      setSelectedTableIds(assignedTables.map((t) => t.id));
    }
  }, [assignedTables]);

  const venueTables = form.venueId
    ? existingTables.filter((table) => table.venueId === form.venueId)
    : [];

  // The cap can't be set below the people already signed up (server enforces it
  // too); disable those options so the choice is clear during registration.
  const minParticipants = tournament
    ? tournament.confirmedCount + tournament.pendingCount
    : 0;

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        description: form.description || undefined,
        rules: form.rules || undefined,
        startDate: form.startDate || undefined,
        ...(selectedTableIds.length > 0 ? { tableIds: selectedTableIds } : {}),
      };
      return isEdit
        ? tournamentsApi.update(tournament.id, payload)
        : tournamentsApi.create(payload);
    },
    onSuccess: () => {
      if (isEdit) {
        qc.invalidateQueries({ queryKey: ['tournament', tournament.id] });
        qc.invalidateQueries({
          queryKey: ['tournament-tables', tournament.id],
        });
      }
      qc.invalidateQueries({ queryKey: ['tournaments'] });
      qc.invalidateQueries({ queryKey: ['tables'] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const canSubmit =
    venues.length > 0 && form.venueId !== '' && !save.isPending;

  const toggleTable = (id: string) => {
    setSelectedTableIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start md:items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg my-4 md:my-0">
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">
            {isEdit ? 'Редактировать турнир' : 'Новый турнир'}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            ×
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) {
              return;
            }
            save.mutate();
          }}
          className="p-5 space-y-4"
        >
          {venues.length === 0 && (
            <div className="p-3 bg-amber-50 text-amber-800 text-sm rounded-lg border border-amber-200">
              Для создания турнира нужна хотя бы одна площадка.{' '}
              <Link to="/venues" className="underline font-medium">
                Перейти к площадкам
              </Link>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Название *
            </label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Площадка *
            </label>
            <select
              required
              value={form.venueId}
              onChange={(e) => {
                const venueId = e.target.value;
                setForm({ ...form, venueId });
                setSelectedTableIds([]);
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Выберите площадку</option>
              {venues.map((venue) => (
                <option key={venue.id} value={venue.id}>
                  {venue.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Формат
            </label>
            <select
              value={form.format}
              onChange={(e) => {
                const format = e.target.value as typeof form.format;
                setForm({
                  ...form,
                  format,
                  // Random pairing is meaningless for round-robin.
                  randomAdvancement:
                    format === 'round_robin' ? false : form.randomAdvancement,
                });
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {formats.map((f) => (
                <option key={f} value={f}>
                  {FORMAT_LABELS[f]}
                </option>
              ))}
            </select>
          </div>

          {form.format !== 'round_robin' && (
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <input
                  type="checkbox"
                  checked={form.randomAdvancement}
                  onChange={(e) =>
                    setForm({ ...form, randomAdvancement: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                Случайные пары после каждого раунда
              </label>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Видимость
              </label>
              <select
                value={form.visibility}
                onChange={(e) =>
                  setForm({
                    ...form,
                    visibility: e.target.value as TournamentVisibility,
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {(Object.keys(VISIBILITY_LABELS) as TournamentVisibility[]).map((v) => (
                  <option key={v} value={v}>
                    {VISIBILITY_LABELS[v]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Режим расписания
              </label>
              <select
                value={form.scheduleMode}
                onChange={(e) =>
                  setForm({
                    ...form,
                    scheduleMode: e.target.value as TournamentScheduleMode,
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {(Object.keys(SCHEDULE_MODE_LABELS) as TournamentScheduleMode[]).map(
                  (m) => (
                    <option key={m} value={m}>
                      {SCHEDULE_MODE_LABELS[m]}
                    </option>
                  ),
                )}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Макс. участников
              </label>
              <select
                value={form.maxParticipants}
                onChange={(e) => {
                  const mp = Number(e.target.value);
                  const valid = validMergeRoundsForSize(mp);
                  const maxValid = valid[valid.length - 1] ?? 2;
                  setForm({
                    ...form,
                    maxParticipants: mp,
                    // Keep the merge round within the new bracket's valid range.
                    mergeRound: Math.min(form.mergeRound, maxValid),
                  });
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {maxParticipants.map((n) => (
                  <option key={n} value={n} disabled={n < minParticipants}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Win score
              </label>
              <select
                value={form.winScore}
                onChange={(e) =>
                  setForm({ ...form, winScore: Number(e.target.value) })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {winScores.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {form.format === 'double_elimination' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Раунд объединения
              </label>
              <select
                value={form.mergeRound}
                onChange={(e) =>
                  setForm({ ...form, mergeRound: Number(e.target.value) })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {validMergeRoundsForSize(form.maxParticipants).map(
                  (m, i, arr) => (
                    <option key={m} value={m}>
                      {m === arr[arr.length - 1] ? `${m} (полный DE)` : m}
                    </option>
                  ),
                )}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                После какого раунда верхней сетки нижняя объединяется с верхней.
                2 — стандартная схема; максимум — полный double elimination.
              </p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Дата начала
            </label>
            <input
              type="datetime-local"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Описание
            </label>
            <textarea
              rows={2}
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {/* Tables section */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Столы
            </label>

            {form.venueId === '' && (
              <div className="text-xs text-gray-500">
                Сначала выберите площадку.
              </div>
            )}

            {form.venueId !== '' && venueTables.length === 0 && (
              <div className="text-xs text-gray-500">
                Для этой площадки столов нет. Турнир можно создать без столов.
              </div>
            )}

            {form.venueId !== '' && venueTables.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {venueTables.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleTable(t.id)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      selectedTableIds.includes(t.id)
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
                    }`}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {isEdit
                ? save.isPending
                  ? 'Сохранение...'
                  : 'Сохранить'
                : save.isPending
                  ? 'Создание...'
                  : 'Создать'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function CreateTournamentModal({
  onClose,
}: {
  onClose: () => void;
}) {
  return <TournamentFormModal mode="create" onClose={onClose} />;
}

export function EditTournamentModal({
  tournament,
  onClose,
}: {
  tournament: ApiTournament;
  onClose: () => void;
}) {
  return (
    <TournamentFormModal mode="edit" tournament={tournament} onClose={onClose} />
  );
}
