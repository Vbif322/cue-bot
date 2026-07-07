// Сетка/таблица турнира (макет tournament-bracket). Для форматов на выбывание —
// дерево; для кругового/групп — таблица результатов. Клик по матчу → модалка.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { tournamentsApi } from '../lib/api.ts';
import type { AppBracket } from '../lib/types.ts';
import { useMe } from '../lib/useAuth.ts';
import { displayName, formatLabel, groupLetter, isEliminationFormat } from '../lib/format.ts';
import Bracket from '../components/Bracket.tsx';
import MatchModal from '../components/MatchModal.tsx';
import { EmptyState, ErrorBox, Loader } from '../components/ui.tsx';

function StandingsTables({ bracket }: { bracket: AppBracket }) {
  const multi = bracket.standings.length > 1;
  return (
    <div style={{ padding: '16px 16px 32px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {bracket.standings.map((group) => (
        <div key={group.groupIndex} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {multi && (
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>
              Группа {groupLetter(group.groupIndex)}
            </div>
          )}
          <div style={{ overflowX: 'auto' }} className="cb-scroll">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 420 }}>
              <thead>
                <tr style={{ color: 'var(--text-faint)', textAlign: 'left' }}>
                  <th style={{ padding: '8px 10px', fontWeight: 600 }}>#</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600 }}>Игрок</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600, textAlign: 'center' }}>И</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600, textAlign: 'center' }}>В</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600, textAlign: 'center' }}>П</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600, textAlign: 'center' }}>Фреймы</th>
                  <th style={{ padding: '8px 10px', fontWeight: 600, textAlign: 'center' }}>±</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => {
                  const p = bracket.players[row.userId];
                  return (
                    <tr key={row.userId} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '10px', color: 'var(--text-muted)', fontWeight: 700 }}>{row.rank}</td>
                      <td style={{ padding: '10px', color: 'var(--text-primary)' }}>{p ? displayName(p) : 'Игрок'}</td>
                      <td style={{ padding: '10px', textAlign: 'center', color: 'var(--text-secondary)' }}>{row.played}</td>
                      <td style={{ padding: '10px', textAlign: 'center', color: 'var(--color-tone-success-fg)' }}>{row.wins}</td>
                      <td style={{ padding: '10px', textAlign: 'center', color: 'var(--color-tone-danger-fg)' }}>{row.losses}</td>
                      <td style={{ padding: '10px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        {row.framesWon}:{row.framesLost}
                      </td>
                      <td style={{ padding: '10px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        {row.frameDiff > 0 ? `+${row.frameDiff}` : row.frameDiff}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function BracketPage() {
  const { id = '' } = useParams();
  const { data: me } = useMe();
  const myId = me?.user?.id ?? null;
  const [selected, setSelected] = useState<string | null>(null);

  const { data: bracket, isLoading, error } = useQuery({
    queryKey: ['bracket', id],
    queryFn: () => tournamentsApi.bracket(id),
  });

  if (isLoading) return <Loader />;
  if (error || !bracket) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: 20 }}>
        <ErrorBox message={error?.message ?? 'Сетка не найдена'} />
      </div>
    );
  }

  const t = bracket.tournament;
  const elimination = isEliminationFormat(t.format);
  const hasMatches = bracket.matches.some((m) => m.phase !== 'group');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 84px)' }}>
      <div
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '13px 16px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--surface-1)',
        }}
      >
        <Link to={`/tournaments/${id}`} style={{ fontSize: 18, color: 'var(--text-faint)', textDecoration: 'none', lineHeight: 1 }}>
          ←
        </Link>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>
            {elimination ? 'Сетка турнира' : 'Таблица турнира'}
          </div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--text-faint)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {t.name} · {formatLabel(t.format)}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        {elimination ? (
          hasMatches ? (
            <Bracket bracket={bracket} myId={myId} onSelectMatch={setSelected} />
          ) : (
            <EmptyState title="Сетка ещё не сформирована" hint="Появится после старта турнира." />
          )
        ) : bracket.standings.length > 0 ? (
          <div className="cb-scroll" style={{ height: '100%', overflowY: 'auto' }}>
            <StandingsTables bracket={bracket} />
          </div>
        ) : (
          <EmptyState title="Таблица пуста" hint="Появится после первых матчей." />
        )}
      </div>

      {selected && <MatchModal matchId={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
