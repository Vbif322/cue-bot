import type { ApiTournament, ApiTable } from '../../lib/api.ts';
import { TournamentStatusBadge } from '../StatusBadge.tsx';
import { FORMAT_LABELS } from './TournamentHeader.tsx';

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
      <InfoRow label="Формат" value={FORMAT_LABELS[tournament.format]} />
      <InfoRow
        label="Участники"
        value={`${tournament.confirmedParticipants ?? 0} / ${tournament.maxParticipants}`}
      />
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

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <span className="text-sm text-gray-500 w-36 shrink-0">{label}</span>
      <span className="text-sm text-gray-900">{value}</span>
    </div>
  );
}
