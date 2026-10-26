import { useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useMe, useLogout } from '../lib/useAuth.ts';
import { useFederation } from '../lib/federation.tsx';

const navItems = [
  { to: '/tournaments', label: 'Турниры' },
  { to: '/venues', label: 'Площадки' },
  { to: '/users', label: 'Пользователи' },
  { to: '/leaderboard', label: 'Лидеры' },
  { to: '/federations', label: 'Организации' },
];

const ROLE_LABELS = { owner: 'владелец', organizer: 'организатор' } as const;

/**
 * Переключатель текущей организации. Платформенный админ выбирает между «Все»,
 * «Платформа» и любой из своих; организатор с одной федерацией видит только её
 * название (переключать нечего).
 */
function FederationSwitcher() {
  const { current, setCurrent, federations, isPlatformAdmin } = useFederation();
  const options: { value: string; label: string }[] = [];
  if (isPlatformAdmin) {
    options.push({ value: 'all', label: 'Все организации' });
    options.push({ value: 'platform', label: 'Платформа (без организации)' });
  }
  for (const f of federations) options.push({ value: f.id, label: f.name });

  if (options.length === 0) return null;
  if (options.length === 1) {
    return (
      <div className="px-3 py-2 text-sm text-gray-700 bg-gray-50 rounded-md truncate">
        {options[0]!.label}
      </div>
    );
  }
  return (
    <select
      aria-label="Организация"
      value={current}
      onChange={(e) => setCurrent(e.target.value)}
      className="w-full px-2 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Подсказка организатору: ещё нет своей организации (право выдано, но
 * организация не создана) или срок права у владельцев текущей истёк.
 */
function OrganizerNotice() {
  const { isPlatformAdmin, federations, currentFederation } = useFederation();
  if (isPlatformAdmin) return null;
  if (federations.length === 0) {
    return (
      <div className="mb-4 p-3 bg-blue-50 text-blue-800 text-sm rounded-lg border border-blue-100">
        Создайте свою организацию в разделе{' '}
        <NavLink to="/federations" className="underline">
          «Организации»
        </NavLink>
        , чтобы проводить турниры.
      </div>
    );
  }
  const until = currentFederation?.activeUntil
    ? new Date(currentFederation.activeUntil)
    : null;
  if (currentFederation && (until === null || until <= new Date())) {
    return (
      <div className="mb-4 p-3 bg-amber-50 text-amber-800 text-sm rounded-lg border border-amber-100">
        Срок права организатора у владельцев «{currentFederation.name}» истёк:
        новые турниры недоступны, текущие можно доиграть. Для продления
        обратитесь к администратору платформы.
      </div>
    );
  }
  return null;
}

export default function Layout({ children }: { children: ReactNode }) {
  const { data } = useMe();
  const { mutate: logout } = useLogout();
  const { currentRole, isPlatformAdmin } = useFederation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const roleLabel = isPlatformAdmin
    ? 'администратор'
    : currentRole
      ? ROLE_LABELS[currentRole]
      : null;

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* Mobile backdrop */}
      <div
        onClick={() => setSidebarOpen(false)}
        className={`fixed inset-0 z-20 bg-black/40 md:hidden transition-opacity duration-200 ${
          sidebarOpen
            ? 'opacity-100 pointer-events-auto'
            : 'opacity-0 pointer-events-none'
        }`}
      />

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-56 bg-white border-r border-gray-200 flex flex-col transition-transform duration-200 md:sticky md:top-0 md:h-screen md:translate-x-0 md:z-auto ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="shrink-0 p-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h1 className="font-semibold text-gray-900">Cue Bot</h1>
            <p className="text-xs text-gray-500 mt-0.5">Панель управления</p>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            aria-label="Закрыть меню"
            className="md:hidden p-1 rounded text-gray-400 hover:text-gray-600"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="shrink-0 p-3 border-b border-gray-200">
          <FederationSwitcher />
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-700 hover:bg-gray-100'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="shrink-0 p-3 border-t border-gray-200">
          <p className="text-xs text-gray-500 mb-2">
            @{data?.user?.username}
            {roleLabel && <span className="text-gray-400"> · {roleLabel}</span>}
          </p>
          {data?.playerUrl && (
            <a
              href={data.playerUrl}
              className="block px-3 py-2 text-sm text-gray-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors"
            >
              Сайт игрока
            </a>
          )}
          <button
            onClick={() => logout()}
            className="w-full text-left px-3 py-2 text-sm text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
          >
            Выйти
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-4 md:p-6">
        <div className="md:hidden mb-4">
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Открыть меню"
            className="p-2 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
        </div>
        <OrganizerNotice />
        {children}
      </main>
    </div>
  );
}
