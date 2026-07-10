// Профиль игрока (макет profile): обзор со статистикой и историей + настройки
// (email read-only, имя/фамилия, выход). Паролей нет — секция пароля не нужна.
import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, type BadgeTone } from '@cue-bot/ui';
import { meApi } from '../lib/api.ts';
import { getTelegramInitData } from '../lib/telegram.ts';
import { useMe, useLogout } from '../lib/useAuth.ts';
import { displayName, initials, gradientFor, formatDate } from '../lib/format.ts';
import { Btn, Field, Labeled } from '../components/controls.tsx';
import { ErrorBox, Loader, StatTile } from '../components/ui.tsx';
import {
  TelegramLoginButton,
  useTelegramLoginEnabled,
} from '../components/TelegramLoginButton.tsx';

type Tab = 'overview' | 'settings';

// Сообщения по коду из ?telegram= (редирект бэкенда после OIDC-привязки).
const TELEGRAM_LINK_ERRORS: Record<string, string> = {
  error: 'Не удалось привязать Telegram. Попробуйте ещё раз.',
  cancelled: 'Привязка Telegram отменена.',
  exists: 'Этот Telegram уже привязан к другому аккаунту.',
  has_other: 'К аккаунту уже привязан другой Telegram.',
};

export default function ProfilePage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const loc = useLocation();
  const { data: me } = useMe();
  const telegramEnabled = useTelegramLoginEnabled();
  const telegramLinkError =
    TELEGRAM_LINK_ERRORS[new URLSearchParams(loc.search).get('telegram') ?? ''];
  const [tab, setTab] = useState<Tab>('overview');

  const { data: profile, isLoading } = useQuery({
    queryKey: ['me', 'profile'],
    queryFn: () => meApi.get(),
  });
  const { data: stats } = useQuery({ queryKey: ['me', 'stats'], queryFn: () => meApi.stats() });

  const [name, setName] = useState('');
  const [surname, setSurname] = useState('');
  useEffect(() => {
    if (profile) {
      setName(profile.name ?? '');
      setSurname(profile.surname ?? '');
    }
  }, [profile?.name, profile?.surname]);

  const updateMut = useMutation({
    mutationFn: () =>
      meApi.update({ name: name.trim() || null, surname: surname.trim() || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me', 'profile'] });
      qc.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
  });

  const logoutMut = useLogout();
  const doLogout = async () => {
    await logoutMut.mutateAsync();
    nav('/login', { replace: true });
  };

  if (isLoading || !profile) return <Loader />;

  const user = me?.user ?? profile;
  const played = stats?.matches.played ?? 0;
  const wins = stats?.matches.wins ?? 0;
  const losses = stats?.matches.losses ?? 0;
  const winrate = played > 0 ? Math.round((wins / played) * 100) : 0;

  return (
    <div
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '24px 20px 32px',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 22,
      }}
    >
      {/* Шапка профиля */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <span
          style={{
            width: 72,
            height: 72,
            borderRadius: '50%',
            flex: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 24,
            fontWeight: 700,
            color: '#fff',
            background: gradientFor(profile.id),
          }}
        >
          {initials(profile)}
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{displayName(profile)}</div>
          <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>
            {profile.email ?? 'Игрок'}
          </div>
        </div>
      </div>

      {/* Табы */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          padding: 4,
          background: 'var(--surface-inset)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 12,
          width: 'fit-content',
        }}
      >
        {(['overview', 'settings'] as Tab[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            style={{
              padding: '8px 18px',
              border: 'none',
              borderRadius: 9,
              background: tab === key ? 'var(--color-primary)' : 'transparent',
              color: tab === key ? '#fff' : 'var(--text-muted)',
              fontSize: 14,
              fontWeight: tab === key ? 600 : 500,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {key === 'overview' ? 'Обзор' : 'Настройки'}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <StatTile value={played} label="Сыграно" />
            <StatTile value={wins} label="Победы" color="var(--color-tone-success-fg)" />
            <StatTile value={losses} label="Поражения" color="var(--color-tone-danger-fg)" />
          </div>

          <div
            style={{
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              background: 'var(--surface-2)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 14,
              padding: '16px 18px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Процент побед</span>
              <span style={{ fontSize: 15, fontWeight: 700 }}>{winrate}%</span>
            </div>
            <div style={{ display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden', background: 'var(--border-default)' }}>
              <div style={{ width: `${winrate}%`, background: 'linear-gradient(90deg,#10b981,#34d399)' }} />
              <div style={{ flex: 1, background: 'var(--color-tone-danger-bg)' }} />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--text-faint)',
              }}
            >
              История турниров
            </div>
            {(stats?.tournamentHistory.length ?? 0) === 0 ? (
              <div style={{ fontSize: 14, color: 'var(--text-faint)' }}>Завершённых турниров пока нет.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {stats!.tournamentHistory.map((h) => (
                  <div
                    key={h.id}
                    style={{
                      boxSizing: 'border-box',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 12,
                      padding: '13px 15px',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {h.name}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{formatDate(h.completedAt)}</span>
                    </div>
                    <Badge tone={(h.isWinner ? 'warning' : 'neutral') as BadgeTone}>
                      {h.isWinner ? '1 место' : 'Участник'}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          {/* Email (read-only) */}
          <div
            style={{
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              background: 'var(--surface-2)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 16,
              padding: 18,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>Электронная почта</span>
              <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                Используется для входа.{' '}
                {profile.emailVerified ? 'Подтверждена.' : 'Не подтверждена.'}
              </span>
            </div>
            <Labeled label="Email">
              <Field type="email" value={profile.email ?? ''} disabled readOnly />
            </Labeled>
          </div>

          {/* Имя/фамилия */}
          <div
            style={{
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              background: 'var(--surface-2)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 16,
              padding: 18,
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 700 }}>Профиль</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ flex: '1 1 200px' }}>
                <Labeled label="Имя">
                  <Field value={name} maxLength={50} onChange={(e) => setName(e.target.value)} placeholder="Имя" />
                </Labeled>
              </div>
              <div style={{ flex: '1 1 200px' }}>
                <Labeled label="Фамилия">
                  <Field value={surname} maxLength={100} onChange={(e) => setSurname(e.target.value)} placeholder="Фамилия" />
                </Labeled>
              </div>
            </div>
            {updateMut.error && <ErrorBox message={updateMut.error.message} />}
            {updateMut.isSuccess && !updateMut.isPending && (
              <div style={{ fontSize: 13, color: 'var(--color-tone-success-fg)' }}>Сохранено.</div>
            )}
            <Btn
              size="sm"
              style={{ alignSelf: 'flex-start' }}
              disabled={updateMut.isPending}
              onClick={() => updateMut.mutate()}
            >
              {updateMut.isPending ? 'Сохранение…' : 'Сохранить'}
            </Btn>
          </div>

          {/* Telegram — скрываем блок целиком, если вход через Telegram не
              настроен (нет OIDC-клиента) и аккаунт ещё не привязан. */}
          {(telegramEnabled || profile.telegramLinked) && (
            <div
              style={{
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
                background: 'var(--surface-2)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 16,
                padding: 18,
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>Telegram</span>
                <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                  Привяжите Telegram, чтобы входить через него и получать уведомления в боте.
                </span>
              </div>
              {profile.telegramLinked ? (
                <div style={{ fontSize: 14, color: 'var(--color-tone-success-fg)' }}>Привязан.</div>
              ) : (
                <>
                  <TelegramLoginButton link size="medium" />
                  {telegramLinkError && <ErrorBox message={telegramLinkError} />}
                </>
              )}
            </div>
          )}

          {/* В Mini App выхода нет: сессия привязана к Telegram-аккаунту, и авто-вход
              по initData тут же вернул бы её (useMe) — кнопка была бы самообманом. */}
          {getTelegramInitData() === null && (
            <Btn
              variant="danger"
              size="sm"
              style={{ alignSelf: 'flex-start' }}
              disabled={logoutMut.isPending}
              onClick={doLogout}
            >
              Выйти из аккаунта
            </Btn>
          )}
        </div>
      )}
    </div>
  );
}
