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
        background: 'var(--surface-2)',
        border: '1px solid var(--border-subtle)',
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
            color: 'var(--text-faint)',
          }}
        >
          {disciplineLabel(tournament.discipline)}
        </span>
        <TournamentStatusBadge status={tournament.status} />
      </div>

      <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.2 }}>{tournament.name}</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-muted)' }}>
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
          <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Участники</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
            <span style={{ color: 'var(--text-primary)' }}>{confirmed}</span> / {max}
          </span>
        </div>
        <ProgressBar percent={fillPercent(confirmed, max)} />
      </div>
    </Link>
  );
}
