import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { tournamentsApi, tablesApi, venuesApi } from '../lib/api.ts';
import { formats } from '@server/apiTypes';
import type { ITournamentFormat } from '../lib/api.ts';

const FORMAT_OPTIONS: Record<ITournamentFormat, string> = {
  single_elimination: 'Single Elimination',
  double_elimination: 'Double Elimination',
  double_elimination_random: 'Double Elimination (random)',
  round_robin: 'Round Robin',
};

export default function CreateTournamentModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: '',
    description: '',
    rules: '',
    format: 'single_elimination' as const,
    maxParticipants: 16,
    winScore: 3,
    startDate: '',
    venueId: '',
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

  const venueTables = form.venueId
    ? existingTables.filter((table) => table.venueId === form.venueId)
    : [];

  const create = useMutation({
    mutationFn: () =>
      tournamentsApi.create({
        ...form,
        description: form.description || undefined,
        rules: form.rules || undefined,
        startDate: form.startDate || undefined,
        ...(selectedTableIds.length > 0 ? { tableIds: selectedTableIds } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tournaments'] });
      qc.invalidateQueries({ queryKey: ['tables'] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const canSubmit =
    venues.length > 0 && form.venueId !== '' && !create.isPending;

  const toggleTable = (id: string) => {
    setSelectedTableIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start md:items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg my-4 md:my-0">
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Новый турнир</h3>
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
            create.mutate();
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
              onChange={(e) =>
                setForm({
                  ...form,
                  format: e.target.value as typeof form.format,
                })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {formats.map((f) => (
                <option key={f} value={f}>
                  {FORMAT_OPTIONS[f]}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Макс. участников
              </label>
              <input
                type="number"
                min={2}
                max={64}
                value={form.maxParticipants}
                onChange={(e) =>
                  setForm({ ...form, maxParticipants: Number(e.target.value) })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Win score
              </label>
              <input
                type="number"
                min={1}
                value={form.winScore}
                onChange={(e) =>
                  setForm({ ...form, winScore: Number(e.target.value) })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

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
              {create.isPending ? 'Создание...' : 'Создать'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
