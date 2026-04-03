import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  venuesApi,
  tablesApi,
  type ApiVenue,
  type ApiTable,
} from '../lib/api.ts';

type EditState = { name: string; address: string; image: string };

export default function VenuesPage() {
  const qc = useQueryClient();
  const { data: venues = [], isLoading } = useQuery({
    queryKey: ['venues'],
    queryFn: () => venuesApi.list(),
  });
  const { data: tables = [] } = useQuery({
    queryKey: ['tables'],
    queryFn: () => tablesApi.list(),
  });

  const [form, setForm] = useState({ name: '', address: '', image: '' });
  const [editId, setEditId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({
    name: '',
    address: '',
    image: '',
  });
  const [newTableNames, setNewTableNames] = useState<Record<string, string>>(
    {},
  );
  const [error, setError] = useState('');

  const tablesByVenue = tables.reduce<Record<string, ApiTable[]>>((acc, t) => {
    acc[t.venueId] = [...(acc[t.venueId] ?? []), t];
    return acc;
  }, {});

  const createVenue = useMutation({
    mutationFn: () =>
      venuesApi.create({
        name: form.name.trim(),
        address: form.address.trim(),
        image: form.image.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['venues'] });
      setForm({ name: '', address: '', image: '' });
      setError('');
    },
    onError: (e: Error) => setError(e.message),
  });

  const updateVenue = useMutation({
    mutationFn: (id: string) =>
      venuesApi.update(id, {
        name: editState.name.trim(),
        address: editState.address.trim(),
        image: editState.image.trim() || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['venues'] });
      setEditId(null);
      setError('');
    },
    onError: (e: Error) => setError(e.message),
  });

  const removeVenue = useMutation({
    mutationFn: (id: string) => venuesApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['venues'] });
      qc.invalidateQueries({ queryKey: ['tables'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const addTable = useMutation({
    mutationFn: ({ name, venueId }: { name: string; venueId: string }) =>
      tablesApi.create(name, venueId),
    onSuccess: (_, { venueId }) => {
      qc.invalidateQueries({ queryKey: ['tables'] });
      setNewTableNames((s) => ({ ...s, [venueId]: '' }));
      setError('');
    },
    onError: (e: Error) => setError(e.message),
  });

  const removeTable = useMutation({
    mutationFn: (id: string) => tablesApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tables'] }),
    onError: (e: Error) => setError(e.message),
  });

  function startEdit(venue: ApiVenue) {
    setEditId(venue.id);
    setEditState({
      name: venue.name,
      address: venue.address,
      image: venue.image ?? '',
    });
    setError('');
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Площадки</h1>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg">
          {error}
        </div>
      )}

      {/* Create venue form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (form.name.trim() && form.address.trim()) createVenue.mutate();
        }}
        className="bg-white border border-gray-200 rounded-lg p-4 mb-6 space-y-3"
      >
        <h2 className="text-sm font-semibold text-gray-700">Новая площадка</h2>
        <input
          value={form.name}
          onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
          placeholder="Название *"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input
          value={form.address}
          onChange={(e) => setForm((s) => ({ ...s, address: e.target.value }))}
          placeholder="Адрес *"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input
          value={form.image}
          onChange={(e) => setForm((s) => ({ ...s, image: e.target.value }))}
          placeholder="URL изображения (необязательно)"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={
            !form.name.trim() || !form.address.trim() || createVenue.isPending
          }
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          Добавить
        </button>
      </form>

      {/* Venues list */}
      {isLoading ? (
        <div className="text-gray-500 text-sm">Загрузка...</div>
      ) : venues.length === 0 ? (
        <div className="text-gray-500 text-sm">Площадок пока нет</div>
      ) : (
        <div className="space-y-4">
          {venues.map((venue) =>
            editId === venue.id ? (
              <div
                key={venue.id}
                className="bg-white border border-blue-300 rounded-lg p-4 space-y-2"
              >
                <input
                  value={editState.name}
                  onChange={(e) =>
                    setEditState((s) => ({ ...s, name: e.target.value }))
                  }
                  placeholder="Название *"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  value={editState.address}
                  onChange={(e) =>
                    setEditState((s) => ({ ...s, address: e.target.value }))
                  }
                  placeholder="Адрес *"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  value={editState.image}
                  onChange={(e) =>
                    setEditState((s) => ({ ...s, image: e.target.value }))
                  }
                  placeholder="URL изображения (необязательно)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => updateVenue.mutate(venue.id)}
                    disabled={
                      !editState.name.trim() ||
                      !editState.address.trim() ||
                      updateVenue.isPending
                    }
                    className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    Сохранить
                  </button>
                  <button
                    onClick={() => setEditId(null)}
                    className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            ) : (
              <div
                key={venue.id}
                className="bg-white border border-gray-200 rounded-lg overflow-hidden"
              >
                {/* Venue header */}
                <div className="p-4 flex gap-3">
                  {venue.image && (
                    <img
                      src={venue.image}
                      alt={venue.name}
                      className="w-16 h-16 object-cover rounded-md flex-shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900">
                      {venue.name}
                    </div>
                    <div className="text-sm text-gray-500 mt-0.5">
                      {venue.address}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 flex-shrink-0">
                    <button
                      onClick={() => startEdit(venue)}
                      className="text-sm text-blue-500 hover:text-blue-700"
                    >
                      Изменить
                    </button>
                    <button
                      onClick={() => removeVenue.mutate(venue.id)}
                      disabled={removeVenue.isPending}
                      className="text-sm text-red-500 hover:text-red-700 disabled:opacity-50"
                    >
                      Удалить
                    </button>
                  </div>
                </div>

                {/* Tables section */}
                <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Столы
                  </div>
                  {(tablesByVenue[venue.id] ?? []).length === 0 ? (
                    <div className="text-xs text-gray-400 mb-2">Нет столов</div>
                  ) : (
                    <div className="space-y-1 mb-2">
                      {(tablesByVenue[venue.id] ?? []).map((table) => (
                        <div
                          key={table.id}
                          className="flex items-center justify-between"
                        >
                          <span className="text-sm text-gray-700">
                            {table.name}
                          </span>
                          <button
                            onClick={() => removeTable.mutate(table.id)}
                            disabled={removeTable.isPending}
                            className="text-xs text-red-400 hover:text-red-600 disabled:opacity-50"
                          >
                            Удалить
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const name = newTableNames[venue.id]?.trim();
                      if (name) addTable.mutate({ name, venueId: venue.id });
                    }}
                    className="flex gap-2"
                  >
                    <input
                      value={newTableNames[venue.id] ?? ''}
                      onChange={(e) =>
                        setNewTableNames((s) => ({
                          ...s,
                          [venue.id]: e.target.value,
                        }))
                      }
                      placeholder="Название стола..."
                      className="flex-1 px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      type="submit"
                      disabled={
                        !newTableNames[venue.id]?.trim() || addTable.isPending
                      }
                      className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
                    >
                      Добавить
                    </button>
                  </form>
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
