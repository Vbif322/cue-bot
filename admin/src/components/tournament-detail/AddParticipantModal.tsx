import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tournamentsApi, usersApi } from '../../lib/api.ts';

export default function AddParticipantModal({
  tournamentId,
  existingParticipantIds,
  onClose,
}: {
  tournamentId: string;
  existingParticipantIds: Set<string>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [modalTab, setModalTab] = useState<'user' | 'external'>('user');
  const [userSearch, setUserSearch] = useState('');
  const [externalName, setExternalName] = useState('');
  const [externalUsername, setExternalUsername] = useState('');
  const [addError, setAddError] = useState('');

  const { data: allUsers } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list(),
    enabled: modalTab === 'user',
  });

  const addParticipantMutation = useMutation({
    mutationFn: (body: Parameters<typeof tournamentsApi.addParticipant>[1]) =>
      tournamentsApi.addParticipant(tournamentId, body),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ['tournament-participants', tournamentId],
      });
      onClose();
    },
    onError: (e: Error) => setAddError(e.message),
  });

  const q = userSearch.toLowerCase();
  const filteredUsers = (allUsers ?? []).filter(
    (u) =>
      !existingParticipantIds.has(u.id) &&
      (!q ||
        u.username.toLowerCase().includes(q) ||
        (u.name ?? '').toLowerCase().includes(q)),
  );

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">Добавить участника</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
          >
            ×
          </button>
        </div>

        <div className="flex gap-1 px-5 pt-4 border-b border-gray-200">
          {(['user', 'external'] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setModalTab(t);
                setAddError('');
              }}
              className={`px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                modalTab === t
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'user' ? 'Зарегистрированный участник' : 'Внешний участник'}
            </button>
          ))}
        </div>

        <div className="p-5 space-y-3">
          {modalTab === 'user' && (
            <>
              <input
                type="text"
                placeholder="Поиск по имени или @username..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="max-h-52 overflow-y-auto divide-y divide-gray-100 border border-gray-200 rounded-lg">
                {filteredUsers.length === 0 ? (
                  <div className="px-3 py-4 text-center text-gray-400 text-sm">
                    Участники не найдены
                  </div>
                ) : (
                  filteredUsers.map((u) => (
                    <button
                      key={u.id}
                      onClick={() =>
                        addParticipantMutation.mutate({
                          type: 'user',
                          userId: u.id,
                        })
                      }
                      disabled={addParticipantMutation.isPending}
                      className="w-full text-left px-3 py-2.5 hover:bg-blue-50 text-sm disabled:opacity-50"
                    >
                      <span className="font-medium">
                        {u.name ?? u.username}
                      </span>
                      <span className="text-gray-400 ml-1.5">
                        @{u.username}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </>
          )}

          {modalTab === 'external' && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Имя участника *
                </label>
                <input
                  type="text"
                  placeholder="Иван Петров"
                  value={externalName}
                  onChange={(e) => setExternalName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Username (необязательно)
                </label>
                <input
                  type="text"
                  placeholder="@username"
                  value={externalUsername}
                  onChange={(e) =>
                    setExternalUsername(e.target.value.replace(/^@/, ''))
                  }
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                onClick={() => {
                  if (!externalName.trim()) {
                    setAddError('Введите имя участника');
                    return;
                  }
                  addParticipantMutation.mutate({
                    type: 'external',
                    name: externalName.trim(),
                    username: externalUsername.trim() || undefined,
                  });
                }}
                disabled={addParticipantMutation.isPending}
                className="w-full py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {addParticipantMutation.isPending
                  ? 'Добавление...'
                  : 'Добавить участника'}
              </button>
            </>
          )}

          {addError && <p className="text-xs text-red-600">{addError}</p>}
        </div>
      </div>
    </div>
  );
}
