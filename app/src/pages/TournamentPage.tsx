// Страница турнира (макет tournament-detail): шапка, карточка регистрации с
// состояниями, описание, участники, ссылка на сетку/таблицу.
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TournamentStatusBadge } from '@cue-bot/ui';
import { tournamentsApi } from '../lib/api.ts';
import type { AppParticipant, TournamentDetail } from '../lib/types.ts';
import { useMe } from '../lib/useAuth.ts';
import {
  disciplineLabel,
  displayName,
  formatDateTime,
  formatLabel,
  isEliminationFormat,
  fillPercent,
} from '../lib/format.ts';
import { Avatar, ErrorBox, Loader, ProgressBar } from '../components/ui.tsx';
import { Btn } from '../components/controls.tsx';

const MAX_SHOWN = 16;

function MetaCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        flex: '1 1 140px',
        boxSizing: 'border-box',
        background: 'var(--surface-inset)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 12,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--text-disabled)',
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>{value}</span>
    </div>
  );
}

function ParticipantChip({ person, you }: { person?: AppParticipant; you?: boolean }) {
  const name = you ? 'Вы' : displayName(person);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        background: you ? 'var(--accent-subtle-bg)' : 'var(--surface-inset)',
        border: you ? '1px solid var(--accent-border)' : '1px solid var(--border-subtle)',
        borderRadius: 999,
        padding: '5px 14px 5px 5px',
      }}
    >
      <Avatar
        person={person}
        label={you ? 'Вы' : undefined}
        gradientKey={you ? 'you' : person?.userId}
        you={you}
        size={32}
      />
      <span
        style={{ fontSize: 14, color: you ? 'var(--text-primary)' : 'var(--text-secondary)', whiteSpace: 'nowrap', fontWeight: you ? 600 : 400 }}
      >
        {name}
      </span>
    </div>
  );
}

function RegistrationCta({
  detail,
  authed,
  myId,
}: {
  detail: TournamentDetail;
  authed: boolean;
  myId: string | null;
}) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const t = detail.tournament;
  const id = t.id;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['tournament', id] });
    qc.invalidateQueries({ queryKey: ['tournaments'] });
    qc.invalidateQueries({ queryKey: ['me', 'tournaments'] });
  };
  const registerMut = useMutation({ mutationFn: () => tournamentsApi.register(id), onSuccess: invalidate });
  const cancelMut = useMutation({ mutationFn: () => tournamentsApi.cancel(id), onSuccess: invalidate });
  const acceptMut = useMutation({ mutationFn: () => tournamentsApi.acceptInvitation(id), onSuccess: invalidate });
  const declineMut = useMutation({ mutationFn: () => tournamentsApi.declineInvitation(id), onSuccess: invalidate });

  const busy =
    registerMut.isPending || cancelMut.isPending || acceptMut.isPending || declineMut.isPending;
  const err =
    registerMut.error?.message ||
    cancelMut.error?.message ||
    acceptMut.error?.message ||
    declineMut.error?.message;

  const ps = detail.participationStatus;
  const isOpen = t.status === 'registration_open';
  const started = t.status === 'in_progress' || t.status === 'completed';
  const isFull = t.confirmedCount >= t.maxParticipants;
  const registered = ps === 'pending' || ps === 'confirmed';

  let cta: ReactNode;
  let helper = '';

  if (!authed) {
    cta = (
      <Btn block onClick={() => nav('/login', { state: { from: `/tournaments/${id}` } })}>
        Войти для регистрации
      </Btn>
    );
    helper = 'Вход по коду на почту.';
  } else if (ps === 'invited') {
    cta = (
      <div style={{ display: 'flex', gap: 10 }}>
        <Btn block disabled={busy} onClick={() => acceptMut.mutate()}>
          Принять приглашение
        </Btn>
        <Btn variant="danger" disabled={busy} onClick={() => declineMut.mutate()}>
          Отклонить
        </Btn>
      </div>
    );
    helper = 'Вас пригласили в этот турнир.';
  } else if (registered) {
    if (started) {
      cta = (
        <Btn block variant="ghost" disabled>
          Вы участвуете
        </Btn>
      );
      helper = 'Турнир идёт — отменить участие уже нельзя.';
    } else {
      cta = (
        <Btn block variant="danger" disabled={busy} onClick={() => cancelMut.mutate()}>
          {cancelMut.isPending ? 'Отмена…' : 'Отменить регистрацию'}
        </Btn>
      );
      helper = ps === 'confirmed' ? 'Вы в списке участников.' : 'Заявка ожидает подтверждения.';
    }
  } else if (ps === 'disqualified') {
    cta = (
      <Btn block variant="ghost" disabled>
        Вы дисквалифицированы
      </Btn>
    );
  } else if (isOpen && isFull) {
    cta = (
      <Btn block disabled>
        Мест нет
      </Btn>
    );
    helper = 'Все места заняты.';
  } else if (isOpen) {
    cta = (
      <Btn block disabled={busy} onClick={() => registerMut.mutate()}>
        {registerMut.isPending ? 'Регистрация…' : 'Зарегистрироваться'}
      </Btn>
    );
    helper = 'Регистрация открыта.';
  } else {
    cta = (
      <Btn block disabled>
        Регистрация закрыта
      </Btn>
    );
  }

  return (
    <div
      style={{
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        background: 'var(--surface-2)',
        border: '1px solid var(--border-default)',
        borderRadius: 18,
        padding: 20,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
          {t.confirmedCount}
          <span style={{ fontSize: 18, color: 'var(--text-faint)', fontWeight: 600 }}> / {t.maxParticipants}</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>участников зарегистрировано</div>
      </div>
      <ProgressBar percent={fillPercent(t.confirmedCount, t.maxParticipants)} />
      {err && <ErrorBox message={err} />}
      {cta}
      {helper && <div style={{ fontSize: 12, color: 'var(--text-faint)', textAlign: 'center' }}>{helper}</div>}
    </div>
  );
}

export default function TournamentPage() {
  const { id = '' } = useParams();
  const { data: me } = useMe();
  const myId = me?.user?.id ?? null;
  const authed = !!me?.user;

  const { data: detail, isLoading, error } = useQuery({
    queryKey: ['tournament', id],
    queryFn: () => tournamentsApi.get(id),
  });

  const { data: participants } = useQuery({
    queryKey: ['tournament', id, 'participants'],
    queryFn: () => tournamentsApi.participants(id),
    enabled: !!detail,
  });

  if (isLoading) return <Loader />;
  if (error || !detail) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: 20 }}>
        <ErrorBox message={error?.message ?? 'Турнир не найден'} />
        <div style={{ marginTop: 16 }}>
          <Link to="/" style={{ color: 'var(--accent-fg)', fontSize: 14 }}>
            ← Все турниры
          </Link>
        </div>
      </div>
    );
  }

  const t = detail.tournament;
  const started = t.status === 'in_progress' || t.status === 'completed';
  const others = (participants ?? []).filter((p) => p.userId !== myId);
  const shown = others.slice(0, MAX_SHOWN);
  const overflow = others.length - shown.length;
  const bracketLinkLabel = isEliminationFormat(t.format) ? 'Смотреть сетку турнира' : 'Смотреть таблицу турнира';

  return (
    <div
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '20px 20px 32px',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
      }}
    >
      <Link to="/" style={{ fontSize: 13, color: 'var(--text-faint)', textDecoration: 'none', width: 'fit-content' }}>
        ← Все турниры
      </Link>

      <header style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--text-faint)',
            }}
          >
            {disciplineLabel(t.discipline)}
          </span>
          <TournamentStatusBadge status={t.status} />
        </div>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.12, fontWeight: 700, letterSpacing: '-0.02em' }}>
          {t.name}
        </h1>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 2 }}>
          <MetaCard
            label="Дата"
            value={t.startDate ? formatDateTime(t.startDate) : 'не назначена'}
          />
          <MetaCard label="Формат" value={formatLabel(t.format)} />
          <MetaCard label="Матчи" value={`до ${t.winScore} побед`} />
        </div>
      </header>

      <RegistrationCta detail={detail} authed={authed} myId={myId} />

      {(t.description || t.rules) && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--text-faint)',
            }}
          >
            Описание
          </div>
          {t.description && (
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
              {t.description}
            </p>
          )}
          {t.rules && (
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>
              {t.rules}
            </p>
          )}
        </section>
      )}

      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--text-faint)',
            }}
          >
            Участники
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-disabled)' }}>{t.confirmedCount}</div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {detail.isParticipant && <ParticipantChip you />}
          {shown.map((p) => (
            <ParticipantChip key={p.userId} person={p} />
          ))}
          {overflow > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                background: 'var(--surface-inset)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 999,
                padding: '5px 14px 5px 5px',
              }}
            >
              <span
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--text-muted)',
                  background: 'var(--surface-inset)',
                }}
              >
                +{overflow}
              </span>
              <span style={{ fontSize: 14, color: 'var(--text-faint)' }}>ещё {overflow}</span>
            </div>
          )}
          {others.length === 0 && !detail.isParticipant && (
            <div style={{ fontSize: 14, color: 'var(--text-faint)' }}>Пока никто не зарегистрировался.</div>
          )}
        </div>
      </section>

      {started ? (
        <Link
          to={`/tournaments/${t.id}/bracket`}
          className="cb-card-link"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            boxSizing: 'border-box',
            background: 'var(--surface-2)',
            border: '1px solid var(--border-default)',
            borderRadius: 14,
            padding: '16px 18px',
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{bracketLinkLabel}</span>
            <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Сетка сформирована</span>
          </div>
          <span style={{ fontSize: 20, color: 'var(--color-primary)' }}>→</span>
        </Link>
      ) : (
        <div
          style={{
            boxSizing: 'border-box',
            background: 'var(--surface-inset)',
            border: '1px dashed var(--border-default)',
            borderRadius: 14,
            padding: '16px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-muted)' }}>
            Сетка ещё не сформирована
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-disabled)' }}>Появится после закрытия регистрации.</span>
        </div>
      )}
    </div>
  );
}
