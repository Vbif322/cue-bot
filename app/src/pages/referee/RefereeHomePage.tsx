// Главная пульта: «Требует внимания» (споры, просроченные вызовы) и турниры
// судьи со счётчиками. Поллится, пока открыта.
import { Link } from 'react-router-dom';
import { TournamentStatusBadge } from '@cue-bot/ui';
import {
  useRefereeOverview,
  useNow,
  useRefereeTitle,
} from '../../lib/useReferee.ts';
import type {
  RefereeAttentionItem,
  RefereeTournamentSummary,
} from '../../lib/types.ts';
import { callCountdown, disputerName } from '../../lib/refereeLogic.ts';
import { EmptyState, ErrorBox, Loader } from '../../components/ui.tsx';
import { MatchLink, Page, Pill, SectionTitle } from './parts.tsx';

function AttentionRow({
  item,
  now,
}: {
  item: RefereeAttentionItem;
  now: number;
}) {
  const { match } = item;
  const disputed = item.reason === 'disputed';
  const who = disputerName(match);
  return (
    <MatchLink
      match={match}
      right={
        <Pill tone={disputed ? 'danger' : 'warning'}>
          {disputed ? 'Спор' : 'Неявка'}
        </Pill>
      }
      notes={
        <>
          <span>{item.tournamentName}</span>
          {match.tableName && <span>· {match.tableName}</span>}
          {disputed ? (
            <span style={{ color: 'var(--color-tone-danger-fg)' }}>
              {who ? `${who} оспорил` : 'оспорен'}
              {match.disputedScore ? ` ${match.disputedScore}` : ''}
            </span>
          ) : (
            <span style={{ color: 'var(--color-tone-warning-fg)' }}>
              {callCountdown(match, now)}
            </span>
          )}
        </>
      }
    />
  );
}

function TournamentRow({ t }: { t: RefereeTournamentSummary }) {
  const running = t.status === 'in_progress';
  const { counts } = t;
  return (
    <Link
      to={`/referee/t/${t.id}`}
      className="cb-card-link"
      style={{
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        background: 'var(--surface-2)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 14,
        padding: 14,
        textDecoration: 'none',
        color: 'inherit',
        opacity: running ? 1 : 0.7,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 16,
            fontWeight: 700,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {t.name}
        </span>
        <TournamentStatusBadge status={t.status} />
      </div>
      {running ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {counts.disputed > 0 && (
            <Pill tone="danger">Спор: {counts.disputed}</Pill>
          )}
          {counts.overdueCalls > 0 && (
            <Pill tone="warning">Неявка: {counts.overdueCalls}</Pill>
          )}
          {counts.inProgress > 0 && (
            <Pill tone="info">Идут: {counts.inProgress}</Pill>
          )}
          {counts.called > 0 && <Pill>Вызваны: {counts.called}</Pill>}
          {counts.pending > 0 && (
            <Pill>Ждут подтверждения: {counts.pending}</Pill>
          )}
          <Pill>
            {t.scheduleMode === 'single_day' ? 'Очередь' : 'Ожидают'}:{' '}
            {counts.queued}
          </Pill>
        </div>
      ) : (
        <span style={{ fontSize: 13, color: 'var(--text-faint)' }}>
          Турнир ещё не начался
        </span>
      )}
    </Link>
  );
}

export default function RefereeHomePage() {
  const { data, isLoading, error } = useRefereeOverview({ poll: true });
  const now = useNow();
  useRefereeTitle();

  if (isLoading) return <Loader />;

  const tournaments = data?.tournaments ?? [];
  const attention = data?.attention ?? [];

  return (
    <Page>
      <div style={{ fontSize: 22, fontWeight: 700 }}>Пульт судьи</div>
      {error && <ErrorBox message={error.message} />}

      {attention.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SectionTitle>Требует внимания</SectionTitle>
          {attention.map((item) => (
            <AttentionRow key={item.match.id} item={item} now={now} />
          ))}
        </section>
      )}

      {tournaments.length === 0 ? (
        <EmptyState
          title="Нет турниров для судейства"
          hint="Здесь появятся турниры, на которые вас назначили судьёй."
        />
      ) : (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SectionTitle>Мои турниры</SectionTitle>
          {tournaments.map((t) => (
            <TournamentRow key={t.id} t={t} />
          ))}
        </section>
      )}
    </Page>
  );
}
