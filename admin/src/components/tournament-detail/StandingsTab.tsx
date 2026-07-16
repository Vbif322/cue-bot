import { useQuery } from '@tanstack/react-query';
import { tournamentsApi } from '../../lib/api.ts';
import type { ApiTournament, ApiPlayerStanding } from '../../lib/api.ts';
import { sportOfDiscipline } from '@server/apiTypes';
import { groupLetter } from '../../lib/tournamentLabels.ts';

function playerName(row: ApiPlayerStanding): string {
  return row.name ?? (row.username ? `@${row.username}` : '—');
}

function diff(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

export default function StandingsTab({
  tournament,
}: {
  tournament: ApiTournament;
}) {
  const qualifiers = tournament.qualifiersPerGroup ?? 0;
  const isSnooker = sportOfDiscipline(tournament.discipline) === 'snooker';

  const { data: standings, isLoading } = useQuery({
    queryKey: ['tournament-standings', tournament.id],
    queryFn: () => tournamentsApi.standings(tournament.id),
  });

  if (isLoading) {
    return <div className="text-gray-500 text-sm">Загрузка...</div>;
  }

  if (!standings || standings.length === 0) {
    return (
      <div className="text-gray-500 text-sm">
        Групповой этап ещё не сформирован.
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {standings.map((group) => (
        <div
          key={group.groupIndex}
          className="rounded-lg border border-gray-200 overflow-hidden"
        >
          <div className="bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700">
            Группа {groupLetter(group.groupIndex)}{' '}
            <span className="text-gray-400">(выходят {qualifiers})</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-xs">
                <th className="px-3 py-1 text-left font-medium">#</th>
                <th className="px-3 py-1 text-left font-medium">Игрок</th>
                <th className="px-2 py-1 text-center font-medium">М</th>
                <th className="px-2 py-1 text-center font-medium">В</th>
                <th className="px-2 py-1 text-center font-medium">П</th>
                <th
                  className="px-2 py-1 text-center font-medium"
                  title="Разница фреймов"
                >
                  ±
                </th>
                {isSnooker && (
                  <th
                    className="px-2 py-1 text-center font-medium"
                    title="Макс. брейк"
                  >
                    Брейк
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {group.rows.map((row) => {
                // Highlight only players who have mathematically clinched a spot,
                // not just whoever currently sits in a qualifying rank.
                return (
                  <tr
                    key={row.userId}
                    className={
                      row.clinched ? 'bg-green-50' : 'border-t border-gray-100'
                    }
                  >
                    <td className="px-3 py-1.5 text-gray-500">{row.rank}</td>
                    <td className="px-3 py-1.5">{playerName(row)}</td>
                    <td className="px-2 py-1.5 text-center text-gray-600">
                      {row.played}
                    </td>
                    <td className="px-2 py-1.5 text-center text-gray-600">
                      {row.wins}
                    </td>
                    <td className="px-2 py-1.5 text-center text-gray-600">
                      {row.losses}
                    </td>
                    <td className="px-2 py-1.5 text-center text-gray-600">
                      {diff(row.frameDiff)}
                    </td>
                    {isSnooker && (
                      <td className="px-2 py-1.5 text-center text-gray-600">
                        {row.maxBreak ?? '—'}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
