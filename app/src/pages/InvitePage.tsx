// Приглашение по деп-линку /invite/:code: карточка турнира + «Присоединиться».
// Гость → сперва вход (с возвратом на этот же экран).
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TournamentStatusBadge } from '@cue-bot/ui';
import { tournamentsApi } from '../lib/api.ts';
import { useMe } from '../lib/useAuth.ts';
import { disciplineLabel, formatDateTime, fillPercent } from '../lib/format.ts';
import { Btn } from '../components/controls.tsx';
import { ErrorBox, Loader, ProgressBar } from '../components/ui.tsx';

export default function InvitePage() {
  const { code = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const authed = !!me?.user;

  const { data: t, isLoading, error } = useQuery({
    queryKey: ['invite', code],
    queryFn: () => tournamentsApi.byInviteCode(code),
  });

  const joinMut = useMutation({
    mutationFn: () => tournamentsApi.joinByInviteCode(code),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me', 'tournaments'] });
      if (t) {
        qc.invalidateQueries({ queryKey: ['tournament', t.id] });
        nav(`/tournaments/${t.id}`);
      }
    },
  });

  if (isLoading) return <Loader />;
  if (error || !t) {
    return (
      <div style={{ maxWidth: 480, margin: '0 auto', padding: 20 }}>
        <ErrorBox message={error?.message ?? 'Приглашение недействительно'} />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '24px 20px', boxSizing: 'border-box' }}>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 14 }}>Вас пригласили в турнир</div>
      <div
        style={{
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          background: '#191b22',
          border: '1px solid rgba(255,255,255,0.09)',
          borderRadius: 18,
          padding: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: '#6b7280',
            }}
          >
            {disciplineLabel(t.discipline)}
          </span>
          <TournamentStatusBadge status={t.status} />
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.15 }}>{t.name}</div>
        <div style={{ fontSize: 13, color: '#9aa0aa' }}>
          {t.startDate ? formatDateTime(t.startDate) : 'Дата не назначена'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span style={{ color: '#6b7280' }}>Участники</span>
            <span style={{ color: '#d1d5db', fontWeight: 600 }}>
              {t.confirmedCount} / {t.maxParticipants}
            </span>
          </div>
          <ProgressBar percent={fillPercent(t.confirmedCount, t.maxParticipants)} />
        </div>

        {joinMut.error && <ErrorBox message={joinMut.error.message} />}

        {authed ? (
          <Btn block disabled={joinMut.isPending} onClick={() => joinMut.mutate()}>
            {joinMut.isPending ? 'Присоединение…' : 'Присоединиться'}
          </Btn>
        ) : (
          <Btn block onClick={() => nav('/login', { state: { from: `/invite/${code}` } })}>
            Войти, чтобы присоединиться
          </Btn>
        )}
      </div>
    </div>
  );
}
