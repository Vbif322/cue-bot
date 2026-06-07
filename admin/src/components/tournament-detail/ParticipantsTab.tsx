import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tournamentsApi } from '../../lib/api.ts';
import type { ApiTournament } from '../../lib/api.ts';
import AddParticipantModal from './AddParticipantModal.tsx';

export default function ParticipantsTab({
  tournamentId,
  tournament,
}: {
  tournamentId: string;
  tournament: ApiTournament;
}) {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [actionError, setActionError] = useState('');

  const { data: participants } = useQuery({
    queryKey: ['tournament-participants', tournamentId],
    queryFn: () => tournamentsApi.participants(tournamentId),
  });

  const invalidateParticipants = () =>
    qc.invalidateQueries({
      queryKey: ['tournament-participants', tournamentId],
    });

  const confirmParticipantMutation = useMutation({
    mutationFn: (userId: string) =>
      tournamentsApi.confirmParticipant(tournamentId, userId),
    onSuccess: invalidateParticipants,
    onError: (e: Error) => setActionError(e.message),
  });

  const rejectParticipantMutation = useMutation({
    mutationFn: (userId: string) =>
      tournamentsApi.rejectParticipant(tournamentId, userId),
    onSuccess: invalidateParticipants,
    onError: (e: Error) => setActionError(e.message),
  });

  const removeParticipantMutation = useMutation({
    mutationFn: (userId: string) =>
      tournamentsApi.removeParticipant(tournamentId, userId),
    onSuccess: invalidateParticipants,
    onError: (e: Error) => setActionError(e.message),
  });

  const setSeedMutation = useMutation({
    mutationFn: ({ userId, seed }: { userId: string; seed: number | null }) =>
      tournamentsApi.setParticipantSeed(tournamentId, userId, seed),
    onSuccess: invalidateParticipants,
    onError: (e: Error) => setActionError(e.message),
  });

  const randomizeSeedsMutation = useMutation({
    mutationFn: () => tournamentsApi.randomizeSeeds(tournamentId),
    onSuccess: invalidateParticipants,
    onError: (e: Error) => setActionError(e.message),
  });

  const confirmedParticipants =
    participants?.filter((p) => p.status === 'confirmed') ?? [];
  const confirmedCount = confirmedParticipants.length;
  const seedCounts = new Map<number, number>();
  for (const p of confirmedParticipants) {
    if (p.seed != null) {
      seedCounts.set(p.seed, (seedCounts.get(p.seed) ?? 0) + 1);
    }
  }
  const seedIsInvalid = (seed: number | null): boolean =>
    seed != null &&
    (seed < 1 || seed > confirmedCount || (seedCounts.get(seed) ?? 0) > 1);
  const hasInvalidSeeds = confirmedParticipants.some((p) =>
    seedIsInvalid(p.seed),
  );
  const freeSeeds: number[] = [];
  if (confirmedCount > 0) {
    for (let s = 1; s <= confirmedCount; s++) {
      if (!seedCounts.has(s)) freeSeeds.push(s);
    }
  }
  const isRegistrationStatus =
    tournament.status === 'registration_open' ||
    tournament.status === 'registration_closed';
  const seedsEditable =
    isRegistrationStatus && tournament.format !== 'round_robin';

  const participantIds = new Set(participants?.map((p) => p.userId) ?? []);

  return (
    <div>
      {actionError && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-200">
          {actionError}
        </div>
      )}

      <div className="flex justify-end gap-2 mb-3">
        {seedsEditable && confirmedCount > 0 && (
          <button
            onClick={() => {
              if (confirm('Перезаписать все сиды случайными значениями?')) {
                randomizeSeedsMutation.mutate();
              }
            }}
            disabled={randomizeSeedsMutation.isPending}
            className="px-3 py-1.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            {randomizeSeedsMutation.isPending
              ? 'Перемешивание...'
              : 'Случайные сиды'}
          </button>
        )}
        <button
          onClick={() => setShowModal(true)}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
        >
          + Добавить участника
        </button>
      </div>

      {seedsEditable && confirmedCount > 0 && (
        <div className="mb-3 space-y-1">
          {freeSeeds.length > 0 && (
            <div className="text-xs text-gray-500">
              Свободные сиды: {freeSeeds.join(', ')}
            </div>
          )}
          {hasInvalidSeeds && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">
              Есть некорректные сиды (дубликаты или вне диапазона 1..
              {confirmedCount}). Запуск турнира заблокирован.
            </div>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium text-gray-600">
                №
              </th>
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
            {participants?.map((p, i) => (
              <tr key={p.userId}>
                <td className="px-4 py-3 font-medium">{i + 1}</td>
                <td className="px-4 py-3">
                  <SeedCell
                    seed={p.seed}
                    editable={seedsEditable && p.status === 'confirmed'}
                    maxSeed={confirmedCount}
                    invalid={
                      p.status === 'confirmed' && seedIsInvalid(p.seed)
                    }
                    saving={
                      setSeedMutation.isPending &&
                      setSeedMutation.variables?.userId === p.userId
                    }
                    onSave={(newSeed) =>
                      setSeedMutation.mutate({
                        userId: p.userId,
                        seed: newSeed,
                      })
                    }
                  />
                </td>
                <td className="px-4 py-3 font-medium">
                  <Link
                    to={`/users/${p.userId}`}
                    className="text-blue-600 hover:text-blue-800 hover:underline"
                  >
                    {p.name ?? p.username ?? p.userId}
                  </Link>
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
                  {isRegistrationStatus && (
                    <div className="flex gap-2 justify-end">
                      {p.status === 'pending' && (
                        <>
                          <button
                            onClick={() =>
                              confirmParticipantMutation.mutate(p.userId)
                            }
                            disabled={
                              (confirmParticipantMutation.isPending &&
                                confirmParticipantMutation.variables ===
                                  p.userId) ||
                              (rejectParticipantMutation.isPending &&
                                rejectParticipantMutation.variables ===
                                  p.userId)
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
                                rejectParticipantMutation.variables ===
                                  p.userId)
                            }
                            className="px-2 py-1 text-xs border border-red-300 text-red-600 rounded hover:bg-red-50 disabled:opacity-50"
                          >
                            Отклонить
                          </button>
                        </>
                      )}
                      {p.status === 'confirmed' && (
                        <button
                          onClick={() =>
                            removeParticipantMutation.mutate(p.userId)
                          }
                          disabled={
                            removeParticipantMutation.isPending &&
                            removeParticipantMutation.variables === p.userId
                          }
                          className="px-2 py-1 text-xs border border-red-300 text-red-600 rounded hover:bg-red-50 disabled:opacity-50"
                        >
                          Снять
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {!participants?.length && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-6 text-center text-gray-400"
                >
                  Нет участников
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <AddParticipantModal
          tournamentId={tournamentId}
          existingParticipantIds={participantIds}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

function ParticipantStatusBadge({ status }: { status: string }) {
  if (status === 'confirmed')
    return (
      <span className="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-700">
        Подтверждён
      </span>
    );
  if (status === 'pending')
    return (
      <span className="px-2 py-0.5 text-xs rounded-full bg-yellow-100 text-yellow-700">
        Ожидает
      </span>
    );
  if (status === 'cancelled')
    return (
      <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-500">
        Отменён
      </span>
    );
  return <span className="text-xs text-gray-500">{status}</span>;
}

function SeedCell({
  seed,
  editable,
  maxSeed,
  invalid,
  saving,
  onSave,
}: {
  seed: number | null;
  editable: boolean;
  maxSeed: number;
  invalid: boolean;
  saving: boolean;
  onSave: (seed: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string>(seed != null ? String(seed) : '');

  if (!editable) {
    return (
      <span
        className={invalid ? 'text-red-600 font-semibold' : 'text-gray-500'}
      >
        {seed ?? '—'}
      </span>
    );
  }

  const commit = () => {
    setEditing(false);
    const trimmed = value.trim();
    const next = trimmed === '' ? null : Number(trimmed);
    if (next != null && (!Number.isInteger(next) || next < 1)) {
      return;
    }
    if (next === seed) return;
    onSave(next);
  };

  if (editing) {
    return (
      <input
        type="number"
        min={1}
        max={maxSeed || undefined}
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setValue(seed != null ? String(seed) : '');
            setEditing(false);
          }
        }}
        disabled={saving}
        className={`w-16 px-2 py-1 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          invalid ? 'border-red-400' : 'border-gray-300'
        }`}
      />
    );
  }

  return (
    <button
      onClick={() => {
        setValue(seed != null ? String(seed) : '');
        setEditing(true);
      }}
      disabled={saving}
      className={`min-w-[2rem] px-2 py-0.5 text-left rounded hover:bg-gray-100 disabled:opacity-50 ${
        invalid
          ? 'text-red-600 font-semibold bg-red-50 border border-red-200'
          : 'text-gray-700'
      }`}
    >
      {saving ? '…' : (seed ?? '—')}
    </button>
  );
}
