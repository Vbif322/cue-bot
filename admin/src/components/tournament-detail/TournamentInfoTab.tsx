import type { ApiTournament, ApiTable } from '../../lib/api.ts';
import { TournamentStatusBadge, InfoRow } from '@cue-bot/ui';
import {
  VISIBILITY_LABELS,
  SCHEDULE_MODE_LABELS,
  SPORT_LABELS,
  DISCIPLINE_LABELS,
  formatParticipants,
  formatLabelWithMode,
} from '../../lib/tournamentLabels.ts';

export default function TournamentInfoTab({
  tournament,
  tables,
}: {
  tournament: ApiTournament;
  tables: ApiTable[] | undefined;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
      <InfoRow
        label="Статус"
        value={<TournamentStatusBadge status={tournament.status} />}
      />
      <InfoRow
        label="Дисциплина"
        value={`${SPORT_LABELS[tournament.sport] ?? tournament.sport} — ${
          DISCIPLINE_LABELS[tournament.discipline] ?? tournament.discipline
        }`}
      />
      <InfoRow
        label="Формат"
        value={formatLabelWithMode(
          tournament.format,
          tournament.randomAdvancement,
        )}
      />
      <InfoRow
        label="Видимость"
        value={
          VISIBILITY_LABELS[tournament.visibility] ?? tournament.visibility
        }
      />
      <InfoRow
        label="Режим расписания"
        value={
          SCHEDULE_MODE_LABELS[tournament.scheduleMode] ??
          tournament.scheduleMode
        }
      />
      <InfoRow label="Участники" value={formatParticipants(tournament)} />
      {tournament.format === 'double_elimination' && (
        <InfoRow
          label="Раунд объединения"
          value={String(tournament.mergeRound)}
        />
      )}
      <InfoRow label="Win score" value={String(tournament.winScore)} />
      {tournament.startDate && (
        <InfoRow
          label="Дата начала"
          value={new Date(tournament.startDate).toLocaleString('ru-RU')}
        />
      )}
      <InfoRow
        label="Столы"
        value={
          tables && tables.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {tables.map((t) => (
                <span
                  key={t.id}
                  className="px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded-full"
                >
                  {t.name}
                </span>
              ))}
            </div>
          ) : (
            '—'
          )
        }
      />
      {tournament.description && (
        <InfoRow label="Описание" value={tournament.description} />
      )}
      {tournament.rules && <InfoRow label="Правила" value={tournament.rules} />}
    </div>
  );
}
