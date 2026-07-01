import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tournamentsApi, usersApi } from '../../lib/api.ts';
import { Modal, Input, Button } from '@cue-bot/ui';

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
    <Modal title="Добавить участника" onClose={onClose}>
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
              <Input
                type="text"
                placeholder="Поиск по имени или @username..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
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
                <Input
                  type="text"
                  placeholder="Иван Петров"
                  value={externalName}
                  onChange={(e) => setExternalName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Username (необязательно)
                </label>
                <Input
                  type="text"
                  placeholder="@username"
                  value={externalUsername}
                  onChange={(e) =>
                    setExternalUsername(e.target.value.replace(/^@/, ''))
                  }
                />
              </div>
              <Button
                className="w-full"
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
              >
                {addParticipantMutation.isPending
                  ? 'Добавление...'
                  : 'Добавить участника'}
              </Button>
            </>
          )}

          {addError && <p className="text-xs text-red-600">{addError}</p>}
        </div>
    </Modal>
  );
}
