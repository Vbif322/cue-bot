import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { tournamentsApi } from '../../lib/api.ts';
import type {
  ApiTournament,
  ITournamentFormat,
  TournamentStatus,
} from '../../lib/api.ts';
import { TournamentStatusBadge } from '../StatusBadge.tsx';

export const FORMAT_LABELS: Record<ITournamentFormat, string> = {
  single_elimination: 'Single Elimination',
  double_elimination: 'Double Elimination',
  double_elimination_random: 'Double Elimination (random)',
  round_robin: 'Round Robin',
};

const NEXT_STATUS: Partial<Record<TournamentStatus, TournamentStatus>> = {
  draft: 'registration_open',
  registration_open: 'registration_closed',
  registration_closed: 'in_progress',
};

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

  const statusMutation = useMutation({
    mutationFn: (status: TournamentStatus) =>
      tournamentsApi.setStatus(tournament.id, status),
    onSuccess: () => {
      setActionError('');
      qc.invalidateQueries({ queryKey: ['tournament', tournament.id] });
      qc.invalidateQueries({ queryKey: ['tournaments'] });
    },
    onError: (e: Error) => setActionError(e.message),
  });

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
          {tournament.status === 'in_progress' && (
            <button
              onClick={() => {
                if (confirm('Отменить турнир?'))
                  statusMutation.mutate('cancelled');
              }}
              className="px-4 py-2 border border-red-300 text-red-600 text-sm rounded-lg hover:bg-red-50"
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
    </>
  );
}
