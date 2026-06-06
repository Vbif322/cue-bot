import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { matchesApi } from '../../lib/api.ts';
import { MatchStatusBadge } from '../StatusBadge.tsx';
import { formatUtc } from '../../lib/datetime.ts';

export default function MatchesTab({ tournamentId }: { tournamentId: string }) {
  const { data: matches } = useQuery({
    queryKey: ['tournament-matches', tournamentId],
    queryFn: () => matchesApi.byTournament(tournamentId),
  });

  return (
    <>
      {/* Mobile match cards */}
      <div className="md:hidden space-y-3">
        {!matches?.length && (
          <div className="text-center text-gray-400 py-8 text-sm">
            Матчи не созданы
          </div>
        )}
        {matches?.map((m) => (
          <div
            key={m.id}
            className="bg-white rounded-xl border border-gray-200 p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 font-medium">
                  R{m.round}
                  {m.bracketType === 'losers' && (
                    <span className="text-orange-500 ml-1">L</span>
                  )}
                </span>
                {m.tableName && (
                  <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">
                    {m.tableName}
                  </span>
                )}
                {m.scheduledAt && (
                  <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                    🗓 {formatUtc(m.scheduledAt)}
                  </span>
                )}
              </div>
              <MatchStatusBadge status={m.status} />
            </div>
            <div className="flex items-center justify-center gap-3 my-3">
              <span className="font-medium text-gray-900 text-sm text-right flex-1">
                {m.player1Name ?? m.player1Username ?? 'TBD'}
              </span>
              <span className="font-mono text-gray-700 text-sm px-2">
                {m.player1Score !== null && m.player2Score !== null
                  ? `${m.player1Score}:${m.player2Score}`
                  : 'vs'}
              </span>
              <span className="font-medium text-gray-900 text-sm text-left flex-1">
                {m.player2Name ?? m.player2Username ?? 'TBD'}
              </span>
            </div>
            <div className="text-right">
              <Link to={`/matches/${m.id}`} className="text-blue-500 text-xs">
                Управление
              </Link>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop matches table */}
      <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium text-gray-600">
                Раунд
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">
                Игрок 1
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">
                Счёт
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">
                Игрок 2
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">
                Стол
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">
                Дата
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">
                Статус
              </th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {matches?.map((m) => (
              <tr key={m.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-500">
                  R{m.round}
                  {m.bracketType === 'losers' && (
                    <span className="ml-1 text-xs text-orange-500">L</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {m.player1Name ?? m.player1Username ?? 'TBD'}
                </td>
                <td className="px-4 py-3 font-mono text-center">
                  {m.player1Score !== null && m.player2Score !== null
                    ? `${m.player1Score}:${m.player2Score}`
                    : '—'}
                </td>
                <td className="px-4 py-3">
                  {m.player2Name ?? m.player2Username ?? 'TBD'}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {m.tableName ?? '—'}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                  {formatUtc(m.scheduledAt) || '—'}
                </td>
                <td className="px-4 py-3">
                  <MatchStatusBadge status={m.status} />
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    to={`/matches/${m.id}`}
                    className="text-blue-500 hover:text-blue-700 text-xs"
                  >
                    Управление
                  </Link>
                </td>
              </tr>
            ))}
            {!matches?.length && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-gray-400">
                  Матчи не созданы
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
