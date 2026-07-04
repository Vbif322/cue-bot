// Уведомления (макет notifications, мобильный экран): лента с иконкой типа,
// временем, точкой непрочитанного; «Прочитать всё». Клик → read + переход.
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationsApi } from '../lib/api.ts';
import type { AppNotification, NotificationType } from '../lib/types.ts';
import { EmptyState, ErrorBox, Loader } from '../components/ui.tsx';

type Tone = 'success' | 'warning' | 'info' | 'danger' | 'accent';

const TONE_BY_TYPE: Record<NotificationType, Tone> = {
  registration_confirmed: 'success',
  result_confirmed: 'success',
  tournament_results: 'success',
  registration_rejected: 'danger',
  disqualification: 'danger',
  tournament_cancelled: 'danger',
  result_confirmation_request: 'warning',
  match_result_pending: 'warning',
  result_dispute: 'accent',
  match_reminder: 'info',
  bracket_formed: 'info',
  tournament_invitation: 'info',
  new_registration: 'info',
  participant_limit_reached: 'info',
};

const CHECK_TYPES = new Set<NotificationType>([
  'registration_confirmed',
  'result_confirmed',
  'tournament_results',
  'registration_rejected',
  'disqualification',
]);

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ч`;
  const day = Math.floor(hr / 24);
  if (day === 1) return 'вчера';
  if (day < 7) return `${day} дн`;
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(iso),
  );
}

function Tile({ tone, check }: { tone: Tone; check: boolean }) {
  return (
    <span
      style={{
        flex: 'none',
        width: 42,
        height: 42,
        borderRadius: 12,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `var(--color-tone-${tone}-bg)`,
        color: `var(--color-tone-${tone}-fg)`,
      }}
    >
      {check ? (
        <span
          style={{
            display: 'block',
            width: 10,
            height: 6,
            borderLeft: '2px solid currentColor',
            borderBottom: '2px solid currentColor',
            transform: 'rotate(-45deg)',
            marginTop: -2,
          }}
        />
      ) : (
        <span
          style={{ display: 'block', width: 12, height: 12, border: '2px solid currentColor', borderRadius: '50%' }}
        />
      )}
    </span>
  );
}

export default function NotificationsPage() {
  const qc = useQueryClient();
  const nav = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list({ limit: 100 }),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['notifications'] });
    qc.invalidateQueries({ queryKey: ['notifications', 'unread'] });
  };
  const readMut = useMutation({ mutationFn: (id: string) => notificationsApi.markRead(id), onSuccess: invalidate });
  const readAllMut = useMutation({ mutationFn: () => notificationsApi.markAllRead(), onSuccess: invalidate });

  const list = data ?? [];
  const unread = list.filter((n) => !n.isRead).length;

  const openNotification = (n: AppNotification) => {
    if (!n.isRead) readMut.mutate(n.id);
    if (n.tournamentId) nav(`/tournaments/${n.tournamentId}`);
    else if (n.matchId) nav('/matches');
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', boxSizing: 'border-box' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '18px 16px 12px',
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 700 }}>Уведомления</div>
        {unread > 0 && (
          <span
            style={{
              minWidth: 20,
              height: 20,
              padding: '0 6px',
              boxSizing: 'border-box',
              borderRadius: 999,
              background: 'rgba(59,130,246,0.15)',
              color: '#93c5fd',
              fontSize: 11,
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {unread}
          </span>
        )}
        {unread > 0 && (
          <button
            type="button"
            onClick={() => readAllMut.mutate()}
            disabled={readAllMut.isPending}
            style={{
              marginLeft: 'auto',
              border: 'none',
              background: 'transparent',
              color: '#60a5fa',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Прочитать всё
          </button>
        )}
      </div>

      {error && (
        <div style={{ padding: '0 16px' }}>
          <ErrorBox message={error.message} />
        </div>
      )}
      {isLoading && <Loader />}
      {!isLoading && list.length === 0 && (
        <EmptyState title="Уведомлений нет" hint="Здесь будут события ваших турниров и матчей." />
      )}

      <div>
        {list.map((n) => (
          <div
            key={n.id}
            onClick={() => openNotification(n)}
            style={{
              display: 'flex',
              gap: 13,
              padding: '15px 16px',
              cursor: 'pointer',
              borderBottom: '1px solid rgba(255,255,255,0.05)',
              background: n.isRead ? 'transparent' : 'rgba(59,130,246,0.05)',
            }}
          >
            <Tile tone={TONE_BY_TYPE[n.type] ?? 'info'} check={CHECK_TYPES.has(n.type)} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ flex: 1, fontSize: 15, fontWeight: 600, color: '#f3f4f6' }}>{n.title}</span>
                <span style={{ flex: 'none', fontSize: 11, color: '#565c66', paddingTop: 1 }}>
                  {relativeTime(n.createdAt)}
                </span>
              </div>
              <div style={{ fontSize: 13, color: '#9aa0aa', lineHeight: 1.45 }}>{n.message}</div>
            </div>
            {!n.isRead && (
              <span
                style={{
                  flex: 'none',
                  alignSelf: 'center',
                  width: 9,
                  height: 9,
                  borderRadius: '50%',
                  background: 'var(--color-primary)',
                }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
