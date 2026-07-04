import { Link } from 'react-router-dom';
import { TournamentStatusBadge } from '@cue-bot/ui';
import type { AppTournament } from '../lib/types.ts';
import {
  disciplineLabel,
  formatDateTime,
  fillPercent,
} from '../lib/format.ts';
import { ProgressBar } from './ui.tsx';

/** Карточка турнира в ленте/списках (макет tournament-card). */
export default function TournamentCard({ tournament }: { tournament: AppTournament }) {
  const confirmed = tournament.confirmedCount;
  const max = tournament.maxParticipants;
  const dateText =
    tournament.status === 'in_progress'
      ? 'Идёт сейчас'
      : tournament.startDate
        ? formatDateTime(tournament.startDate)
        : 'Дата не назначена';

  return (
    <Link
      to={`/tournaments/${tournament.id}`}
      style={{
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 13,
        background: '#17181e',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 16,
        padding: 18,
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: '#6b7280',
          }}
        >
          {disciplineLabel(tournament.discipline)}
        </span>
        <TournamentStatusBadge status={tournament.status} />
      </div>

      <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.2 }}>{tournament.name}</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#9aa0aa' }}>
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: 'var(--color-primary)',
            flex: 'none',
          }}
        />
        {dateText}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 2 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, color: '#6b7280' }}>Участники</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#d1d5db' }}>
            <span style={{ color: '#f3f4f6' }}>{confirmed}</span> / {max}
          </span>
        </div>
        <ProgressBar percent={fillPercent(confirmed, max)} />
      </div>
    </Link>
  );
}
