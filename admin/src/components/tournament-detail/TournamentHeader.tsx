import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { tournamentsApi } from '../../lib/api.ts';
import type { ApiTournament, TournamentStatus } from '../../lib/api.ts';
import { TournamentStatusBadge } from '../StatusBadge.tsx';
import { EditTournamentModal } from '../CreateTournamentModal.tsx';
import { FORMAT_LABELS } from '../../lib/tournamentLabels.ts';

const NEXT_STATUS: Partial<Record<TournamentStatus, TournamentStatus>> = {
  draft: 'registration_open',
  registration_open: 'registration_closed',
  registration_closed: 'in_progress',
};

// Settings stay editable until the bracket is generated (i.e. before start).
// Mirrors canEditTournament / EDITABLE_STATUSES on the server.
const EDITABLE_STATUSES: TournamentStatus[] = [
  'draft',
  'registration_open',
  'registration_closed',
];

const STATUS_ACTION_LABELS: Partial<Record<TournamentStatus, string>> = {
  draft: 'Открыть регистрацию',
  registration_open: 'Закрыть регистрацию',
  registration_closed: 'Запустить турнир',
};

export default function TournamentHeader({
  tournament,
  hasInvalidSeeds,
}: {
  tournament: ApiTournament;
  hasInvalidSeeds: boolean;
}) {
  const qc = useQueryClient();
  const [actionError, setActionError] = useState('');
  const [showEdit, setShowEdit] = useState(false);

  const statusMutation = useMutation({
    mutationFn: (status: TournamentStatus) =>
      tournamentsApi.setStatus(tournament.id, status),
    onSuccess: () => {
      setActionError('');
      qc.invalidateQueries({ queryKey: ['tournament', tournament.id] });
      qc.invalidateQueries({ queryKey: ['tournaments'] });
      // Cancellation also marks unfinished matches as cancelled.
      qc.invalidateQueries({
        queryKey: ['tournament-matches', tournament.id],
      });
    },
    onError: (e: Error) => setActionError(e.message),
  });

  // Cancellation is available on every stage except draft (delete it),
  // completed and already-cancelled tournaments.
  const canCancel = (
    [
      'registration_open',
      'registration_closed',
      'in_progress',
    ] as TournamentStatus[]
  ).includes(tournament.status);

  const startMutation = useMutation({
    mutationFn: () => tournamentsApi.start(tournament.id),
    onSuccess: () => {
      setActionError('');
      qc.invalidateQueries({ queryKey: ['tournament', tournament.id] });
      qc.invalidateQueries({ queryKey: ['tournaments'] });
      qc.invalidateQueries({
        queryKey: ['tournament-matches', tournament.id],
      });
    },
    onError: (e: Error) => setActionError(e.message),
  });

  const nextStatus = NEXT_STATUS[tournament.status];
  const nextLabel = STATUS_ACTION_LABELS[tournament.status];
  const startBlockedBySeeds = nextStatus === 'in_progress' && hasInvalidSeeds;

  const handleNextAction = () => {
    if (!nextStatus) return;
    if (nextStatus === 'in_progress') {
      if (
        !confirm('Запустить турнир? Это создаст сетку и уведомит участников.')
      )
        return;
      startMutation.mutate();
    } else {
      statusMutation.mutate(nextStatus);
    }
  };

  return (
    <>
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
          {EDITABLE_STATUSES.includes(tournament.status) && (
            <button
              onClick={() => setShowEdit(true)}
              className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50"
            >
              Редактировать
            </button>
          )}
          {nextStatus && nextLabel && (
            <button
              onClick={handleNextAction}
              disabled={
                statusMutation.isPending ||
                startMutation.isPending ||
                startBlockedBySeeds
              }
              title={
                startBlockedBySeeds
                  ? 'Разрешите конфликты сидов перед запуском'
                  : undefined
              }
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {statusMutation.isPending || startMutation.isPending
                ? 'Обработка...'
                : nextLabel}
            </button>
          )}
          {canCancel && (
            <button
              onClick={() => {
                if (confirm('Отменить турнир? Участники получат уведомление.'))
                  statusMutation.mutate('cancelled');
              }}
              disabled={statusMutation.isPending}
              className="px-4 py-2 border border-red-300 text-red-600 text-sm rounded-lg hover:bg-red-50 disabled:opacity-50"
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

      {showEdit && (
        <EditTournamentModal
          tournament={tournament}
          onClose={() => setShowEdit(false)}
        />
      )}
    </>
  );
}
