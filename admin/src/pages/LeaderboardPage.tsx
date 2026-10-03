import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { leaderboardApi } from '../lib/api.ts';
import type { ApiMaxBreakLeaderboardEntry } from '../lib/api.ts';

const displayName = (u: {
  name: string | null;
  surname: string | null;
  username: string;
}) => [u.name, u.surname].filter(Boolean).join(' ') || u.username;

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('ru-RU') : '—';

function TournamentLink({
  tournament,
}: {
  tournament: ApiMaxBreakLeaderboardEntry['tournament'];
}) {
  if (!tournament) return <>—</>;
  return (
    <Link
      to={`/tournaments/${tournament.id}`}
      onClick={(e) => e.stopPropagation()}
      className="text-blue-600 hover:underline"
    >
      {tournament.name}
    </Link>
  );
}

export default function LeaderboardPage() {
  const navigate = useNavigate();
  const { data: rows, isLoading } = useQuery({
    queryKey: ['leaderboard', 'breaks'],
    queryFn: leaderboardApi.breaks,
  });

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Лучшие брейки</h2>
        <p className="text-sm text-gray-500 mt-1">
          Максимальный брейк каждого игрока — от 20 очков
        </p>
      </div>

      {isLoading ? (
        <div className="text-gray-500 text-sm">Загрузка...</div>
      ) : !rows || rows.length === 0 ? (
        <div className="text-gray-500 text-sm">Брейков от 20 пока нет</div>
      ) : (
        <>
          {/* Mobile card list */}
          <div className="md:hidden space-y-3">
            {rows.map((r) => (
              <div
                key={r.userId}
                onClick={() => navigate(`/users/${r.userId}`)}
                className="bg-white rounded-xl border border-gray-200 p-4 cursor-pointer hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 text-sm">
                      <span className="text-gray-400 mr-2">{r.rank}.</span>
                      {displayName(r)}
                    </p>
                    <p className="text-xs text-gray-500">@{r.username}</p>
                  </div>
                  <span className="text-lg font-semibold text-gray-900">
                    {r.maxBreak}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  <TournamentLink tournament={r.tournament} /> ·{' '}
                  {formatDate(r.achievedAt)}
                </p>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-600 w-12">
                    #
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Игрок
                  </th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">
                    Брейк
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Турнир
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Дата
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr
                    key={r.userId}
                    onClick={() => navigate(`/users/${r.userId}`)}
                    className="hover:bg-gray-50 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3 text-gray-500 font-medium">
                      {r.rank}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">
                        {displayName(r)}
                      </p>
                      <p className="text-xs text-gray-500">@{r.username}</p>
                    </td>
                    <td className="px-4 py-3 text-center font-semibold text-gray-900">
                      {r.maxBreak}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      <TournamentLink tournament={r.tournament} />
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {formatDate(r.achievedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
