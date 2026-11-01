import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Input } from '@cue-bot/ui';
import { usersApi } from '../lib/api.ts';
import { useMe } from '../lib/useAuth.ts';
import { useFederation } from '../lib/federation.tsx';

/**
 * Пользователи. Админ видит всех (или ростер выбранной организации);
 * организатор — ростер своих организаций. Поле «@username» находит игрока
 * «со стороны» точным совпадением, чтобы позвать его в турнир.
 */
export default function UsersPage() {
  const navigate = useNavigate();
  const { data: me } = useMe();
  const { param, isPlatformAdmin } = useFederation();
  const [search, setSearch] = useState('');
  const handle = search.trim().startsWith('@') ? search.trim() : undefined;
  const { data: users, isLoading } = useQuery({
    queryKey: ['users', param ?? 'all', handle ?? ''],
    queryFn: () =>
      usersApi.list({
        ...(param && param !== 'platform' ? { federationId: param } : {}),
        ...(handle ? { q: handle } : {}),
      }),
  });
  const q = search.trim().toLowerCase();
  const visible = (users ?? []).filter(
    (u) =>
      handle !== undefined ||
      !q ||
      u.username.toLowerCase().includes(q) ||
      (u.name ?? '').toLowerCase().includes(q) ||
      (u.surname ?? '').toLowerCase().includes(q),
  );

  const displayName = (u: {
    name: string | null;
    surname: string | null;
    username: string;
  }) => [u.name, u.surname].filter(Boolean).join(' ') || u.username;

  return (
    <div>
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center gap-3">
        <h2 className="text-xl font-semibold text-gray-900 flex-1">
          Пользователи
        </h2>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по имени, или @username для точного поиска"
          className="sm:w-80"
        />
      </div>

      {isLoading ? (
        <div className="text-gray-500 text-sm">Загрузка...</div>
      ) : (
        <>
          {/* Mobile card list */}
          <div className="md:hidden space-y-3">
            {visible.map((u) => {
              const isMe = u.id === me?.user?.id;
              return (
                <div
                  key={u.id}
                  onClick={() => navigate(`/users/${u.id}`)}
                  className="bg-white rounded-xl border border-gray-200 p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start justify-between mb-1">
                    <div>
                      <p className="font-medium text-gray-900 text-sm">
                        {displayName(u)}
                        {isMe && (
                          <span className="ml-2 text-xs text-gray-400">
                            (вы)
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-gray-500">@{u.username}</p>
                    </div>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        u.role === 'admin'
                          ? 'bg-purple-100 text-purple-700'
                          : 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {u.role === 'admin' ? 'Администратор' : 'Пользователь'}
                    </span>
                  </div>
                  {isPlatformAdmin && (
                    <p className="text-xs text-gray-400 font-mono">
                      ID: {u.telegram_id}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Пользователь
                  </th>
                  {isPlatformAdmin && (
                    <th className="text-left px-4 py-3 font-medium text-gray-600">
                      Telegram ID
                    </th>
                  )}
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Роль
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.map((u) => {
                  const isMe = u.id === me?.user?.id;
                  return (
                    <tr
                      key={u.id}
                      onClick={() => navigate(`/users/${u.id}`)}
                      className="hover:bg-gray-50 transition-colors cursor-pointer"
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">
                          {displayName(u)}
                          {isMe && (
                            <span className="ml-2 text-xs text-gray-400">
                              (вы)
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-gray-500">@{u.username}</p>
                      </td>
                      {isPlatformAdmin && (
                        <td className="px-4 py-3 text-gray-500 font-mono text-xs">
                          {u.telegram_id}
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            u.role === 'admin'
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {u.role === 'admin'
                            ? 'Администратор'
                            : 'Пользователь'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
