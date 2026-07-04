// Каркас приложения игрока по макету templates/app-layout: десктоп — сайдбар +
// топбар, мобильный — шапка + нижняя таб-навигация. Тёмная тема, mobile-first.
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useMe } from '../lib/useAuth.ts';
import { useIsDesktop } from '../lib/useMediaQuery.ts';
import { notificationsApi } from '../lib/api.ts';
import { displayName, initials, gradientFor } from '../lib/format.ts';

interface NavEntry {
  to: string;
  label: string;
  end?: boolean;
  badge?: boolean;
}

const NAV: NavEntry[] = [
  { to: '/', label: 'Турниры', end: true },
  { to: '/matches', label: 'Матчи' },
  { to: '/my/tournaments', label: 'Мои турниры' },
  { to: '/notifications', label: 'Уведомления', badge: true },
  { to: '/profile', label: 'Профиль' },
];

const TITLES: Record<string, string> = {
  '/': 'Турниры',
  '/matches': 'Матчи',
  '/my/tournaments': 'Мои турниры',
  '/notifications': 'Уведомления',
  '/profile': 'Профиль',
};

function useUnreadCount(): number {
  const { data: me } = useMe();
  const authed = !!me?.user;
  const { data } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => notificationsApi.list({ unreadOnly: true, limit: 100 }),
    enabled: authed,
    staleTime: 30_000,
  });
  return data?.length ?? 0;
}

function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      style={{
        minWidth: 18,
        height: 18,
        padding: '0 5px',
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
      {count > 99 ? '99+' : count}
    </span>
  );
}

function DesktopSidebar({ unread }: { unread: number }) {
  const { data: me } = useMe();
  const user = me?.user;
  return (
    <aside
      style={{
        flex: 'none',
        width: 232,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '20px 14px',
        background: '#101116',
        borderRight: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 10px 18px' }}>
        <span
          style={{
            width: 26,
            height: 26,
            borderRadius: 8,
            background: 'var(--color-primary)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            fontWeight: 800,
            color: '#fff',
          }}
        >
          C
        </span>
        <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>cue·bot</span>
      </div>

      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          style={({ isActive }) => ({
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            gap: 11,
            padding: '9px 12px',
            borderRadius: 10,
            textDecoration: 'none',
            fontSize: 14,
            fontWeight: isActive ? 600 : 500,
            color: isActive ? '#f3f4f6' : '#6b7280',
            background: isActive ? 'rgba(59,130,246,0.12)' : 'transparent',
          })}
        >
          {({ isActive }) => (
            <>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: isActive ? 'var(--color-primary)' : 'transparent',
                  flex: 'none',
                }}
              />
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.badge && <Badge count={unread} />}
            </>
          )}
        </NavLink>
      ))}

      {user && (
        <div
          style={{
            marginTop: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: 10,
            borderRadius: 10,
            background: 'rgba(255,255,255,0.03)',
          }}
        >
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: '50%',
              background: gradientFor(user.id),
              flex: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 700,
              color: '#fff',
            }}
          >
            {initials(user)}
          </span>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {displayName(user)}
            </div>
            <div style={{ fontSize: 11, color: '#6b7280' }}>Игрок</div>
          </div>
        </div>
      )}
    </aside>
  );
}

function MobileBottomNav({ unread }: { unread: number }) {
  return (
    <nav
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        background: 'rgba(16,17,22,0.96)',
        backdropFilter: 'blur(8px)',
        borderTop: '1px solid rgba(255,255,255,0.07)',
        padding: '8px 6px calc(8px + env(safe-area-inset-bottom))',
        zIndex: 20,
      }}
    >
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          style={({ isActive }) => ({
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 5,
            padding: '6px 0',
            textDecoration: 'none',
            color: isActive ? '#f3f4f6' : '#6b7280',
            fontWeight: isActive ? 600 : 500,
          })}
        >
          {({ isActive }) => (
            <>
              <span style={{ position: 'relative', display: 'flex' }}>
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: isActive ? 'var(--color-primary)' : 'transparent',
                    border: isActive ? 'none' : '1px solid #4b5563',
                  }}
                />
                {item.badge && unread > 0 && (
                  <span
                    style={{
                      position: 'absolute',
                      top: -5,
                      left: 8,
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: '#ef4444',
                    }}
                  />
                )}
              </span>
              <span style={{ fontSize: 11 }}>{item.label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

export default function Layout() {
  const isDesktop = useIsDesktop();
  const unread = useUnreadCount();
  const location = useLocation();
  const title = TITLES[location.pathname] ?? 'Cue Bot';

  if (isDesktop) {
    return (
      <div style={{ display: 'flex', height: '100vh', background: '#0d0e12' }}>
        <DesktopSidebar unread={unread} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <main
            className="cb-scroll"
            style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}
          >
            <Outlet />
          </main>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#0d0e12' }}>
      <header
        style={{
          flex: 'none',
          position: 'sticky',
          top: 0,
          zIndex: 10,
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '14px 16px',
          background: 'rgba(16,17,22,0.92)',
          backdropFilter: 'blur(8px)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <span
          style={{
            width: 24,
            height: 24,
            borderRadius: 7,
            background: 'var(--color-primary)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
            fontWeight: 800,
            color: '#fff',
          }}
        >
          C
        </span>
        <span style={{ fontSize: 16, fontWeight: 700 }}>{title}</span>
      </header>

      <main style={{ flex: 1, paddingBottom: 84 }}>
        <Outlet />
      </main>

      <MobileBottomNav unread={unread} />
    </div>
  );
}
