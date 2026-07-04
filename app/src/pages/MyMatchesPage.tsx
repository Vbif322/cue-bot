// Матчи игрока (GET /api/app/me/matches): активные и история. Клик → модалка.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MatchStatusBadge } from '@cue-bot/ui';
import { meApi } from '../lib/api.ts';
import type { AppMatch } from '../lib/types.ts';
import { useMe } from '../lib/useAuth.ts';
import { displayName } from '../lib/format.ts';
import MatchModal from '../components/MatchModal.tsx';
import { EmptyState, ErrorBox, Loader } from '../components/ui.tsx';

function sideLabel(m: AppMatch, slot: 1 | 2, myId: string | null): string {
  const id = slot === 1 ? m.player1Id : m.player2Id;
  const wo = slot === 1 ? m.player1IsWalkover : m.player2IsWalkover;
  if (id && id === myId) return 'Вы';
  if (wo) return 'Проходит';
  if (!id) return 'Ожидается';
  return slot === 1
    ? displayName({ name: m.player1Name, surname: m.player1Surname, username: m.player1Username })
    : displayName({ name: m.player2Name, surname: m.player2Surname, username: m.player2Username });
}

function MatchRow({
  match,
  myId,
  onClick,
}: {
  match: AppMatch;
  myId: string | null;
  onClick: () => void;
}) {
  const needsMe =
    match.status === 'pending_confirmation' && match.reportedBy != null && match.reportedBy !== myId;
  const s1 = match.player1Score;
  const s2 = match.player2Score;
  const scoreText = s1 != null && s2 != null ? `${s1} : ${s2}` : '—';

  return (
    <button
      type="button"
      onClick={onClick}
      className="cb-card-link"
      style={{
        textAlign: 'left',
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: '#17181e',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 14,
        padding: '13px 15px',
        cursor: 'pointer',
        fontFamily: 'inherit',
        color: 'inherit',
        width: '100%',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 600 }}>
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {sideLabel(match, 1, myId)}
          </span>
          <span style={{ color: '#6b7280', fontVariantNumeric: 'tabular-nums', flex: 'none' }}>
            {scoreText}
          </span>
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {sideLabel(match, 2, myId)}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <MatchStatusBadge status={match.status} />
          {needsMe && (
            <span style={{ fontSize: 12, color: '#fcd34d', fontWeight: 600 }}>
              требует подтверждения
            </span>
          )}
        </div>
      </div>
      <span style={{ fontSize: 18, color: '#4b5563', flex: 'none' }}>→</span>
    </button>
  );
}

function Section({
  title,
  matches,
  myId,
  onSelect,
}: {
  title: string;
  matches: AppMatch[];
  myId: string | null;
  onSelect: (id: string) => void;
}) {
  if (matches.length === 0) return null;
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: '#6b7280',
        }}
      >
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {matches.map((m) => (
          <MatchRow key={m.id} match={m} myId={myId} onClick={() => onSelect(m.id)} />
        ))}
      </div>
    </section>
  );
}

export default function MyMatchesPage() {
  const { data: me } = useMe();
  const myId = me?.user?.id ?? null;
  const [selected, setSelected] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['me', 'matches'],
    queryFn: () => meApi.matches(),
  });

  const active = data?.active ?? [];
  const history = data?.history ?? [];
  const empty = !isLoading && active.length === 0 && history.length === 0;

  return (
    <div
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: 20,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 22,
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 700 }}>Матчи</div>
      {error && <ErrorBox message={error.message} />}
      {isLoading && <Loader />}
      {empty && (
        <EmptyState title="Матчей пока нет" hint="Они появятся после старта ваших турниров." />
      )}
      <Section title="Активные" matches={active} myId={myId} onSelect={setSelected} />
      <Section title="История" matches={history} myId={myId} onSelect={setSelected} />

      {selected && <MatchModal matchId={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
