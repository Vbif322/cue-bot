// Таблица лидеров по максимальному брейку (GET /api/app/leaderboard/breaks).
// Публичная; залогиненному игроку подсвечивается его строка.
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { leaderboardApi } from '../lib/api.ts';
import { useMe } from '../lib/useAuth.ts';
import { displayName, formatDateWithYear } from '../lib/format.ts';
import { EmptyState, ErrorBox, Loader } from '../components/ui.tsx';

const th = { padding: '8px 10px', fontWeight: 600 } as const;
const td = { padding: '10px' } as const;

export default function LeaderboardPage() {
  const { data: me } = useMe();
  const myId = me?.user?.id ?? null;
  const { data, isLoading, error } = useQuery({
    queryKey: ['leaderboard', 'breaks'],
    queryFn: () => leaderboardApi.breaks(),
  });

  return (
    <div
      style={{
        maxWidth: 1120,
        margin: '0 auto',
        padding: 20,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 700 }}>Лучшие брейки</div>
      <div
        style={{
          fontSize: 13,
          color: 'var(--text-faint)',
          margin: '4px 0 16px',
        }}
      >
        Максимальный брейк каждого игрока — от 20 очков
      </div>
      {error && <ErrorBox message={error.message} />}
      {isLoading && <Loader />}
      {!isLoading && !error && (data?.length ?? 0) === 0 && (
        <EmptyState
          title="Пока никто не сделал брейк от 20"
          hint="Брейки появятся здесь после подтверждённых матчей с вводом по фреймам."
        />
      )}
      {!isLoading && data && data.length > 0 && (
        <div style={{ overflowX: 'auto' }} className="cb-scroll">
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 13,
              minWidth: 480,
            }}
          >
            <thead>
              <tr style={{ color: 'var(--text-faint)', textAlign: 'left' }}>
                <th style={th}>#</th>
                <th style={th}>Игрок</th>
                <th style={{ ...th, textAlign: 'center' }}>Брейк</th>
                <th style={th}>Турнир</th>
                <th style={th}>Дата</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => {
                const isMe = row.userId === myId;
                return (
                  <tr
                    key={row.userId}
                    style={{
                      borderTop: '1px solid var(--border-subtle)',
                      background: isMe
                        ? 'var(--accent-subtle-bg)'
                        : 'transparent',
                    }}
                  >
                    <td
                      style={{
                        ...td,
                        color: 'var(--text-muted)',
                        fontWeight: 700,
                      }}
                    >
                      {row.rank}
                    </td>
                    <td
                      style={{
                        ...td,
                        color: 'var(--text-primary)',
                        fontWeight: isMe ? 600 : 400,
                      }}
                    >
                      {displayName(row)}
                      {isMe && (
                        <span
                          style={{ marginLeft: 6, color: 'var(--text-faint)' }}
                        >
                          (вы)
                        </span>
                      )}
                    </td>
                    <td
                      style={{
                        ...td,
                        textAlign: 'center',
                        color: 'var(--text-primary)',
                        fontWeight: 700,
                      }}
                    >
                      {row.maxBreak}
                    </td>
                    <td style={{ ...td, color: 'var(--text-secondary)' }}>
                      {row.tournament ? (
                        <Link
                          to={`/tournaments/${row.tournament.id}`}
                          style={{
                            color: 'inherit',
                            textDecoration: 'underline',
                          }}
                        >
                          {row.tournament.name}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td
                      style={{
                        ...td,
                        color: 'var(--text-muted)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {formatDateWithYear(row.achievedAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
