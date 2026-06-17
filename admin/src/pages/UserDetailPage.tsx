import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi, tournamentsApi } from '../lib/api.ts';
import { useMe } from '../lib/useAuth.ts';

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex gap-4">
      <span className="text-sm text-gray-500 w-32 shrink-0">{label}</span>
      <span className="text-sm text-gray-900 break-all">{value}</span>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3 text-center">
      <p className="text-2xl font-semibold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
    </div>
  );
}

const card = 'bg-white rounded-xl border border-gray-200 p-5';

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();

  const { data: user, isLoading } = useQuery({
    queryKey: ['user', id],
    queryFn: () => usersApi.get(id!),
    enabled: !!id,
  });

  const { data: stats } = useQuery({
    queryKey: ['user-stats', id],
    queryFn: () => usersApi.stats(id!),
    enabled: !!id,
  });

  const { data: tournaments } = useQuery({
    queryKey: ['tournaments'],
    queryFn: tournamentsApi.list,
  });

  const [name, setName] = useState('');
  const [surname, setSurname] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedTournament, setSelectedTournament] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  useEffect(() => {
    // Keep the form synced with server data only while not actively editing,
    // so an unrelated refetch doesn't clobber in-progress input.
    if (user && !isEditing) {
      setName(user.name ?? '');
      setSurname(user.surname ?? '');
    }
  }, [user, isEditing]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['user', id] });
    void qc.invalidateQueries({ queryKey: ['user-stats', id] });
    void qc.invalidateQueries({ queryKey: ['users'] });
  };

  const updateMutation = useMutation({
    mutationFn: () =>
      usersApi.update(id!, {
        name: name.trim() || null,
        surname: surname.trim() || null,
      }),
    onSuccess: () => {
      setFormError(null);
      setIsEditing(false);
      invalidate();
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const roleMutation = useMutation({
    mutationFn: (role: 'user' | 'admin') => usersApi.setRole(id!, role),
    onSuccess: invalidate,
  });

  const assignMutation = useMutation({
    mutationFn: (tournamentId: string) =>
      usersApi.assignReferee(id!, tournamentId),
    onSuccess: () => {
      setSelectedTournament('');
      invalidate();
    },
  });

  const removeMutation = useMutation({
    mutationFn: (tournamentId: string) =>
      usersApi.removeReferee(id!, tournamentId),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: () => usersApi.delete(id!),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      navigate('/users');
    },
  });

  if (isLoading || !user || !id) {
    return <div className="text-gray-500 text-sm">Загрузка...</div>;
  }

  const isMe = user.id === me?.user?.id;
  const fullName =
    [user.name, user.surname].filter(Boolean).join(' ') || user.username;
  const winRate =
    stats && stats.matches.played > 0
      ? Math.round((stats.matches.wins / stats.matches.played) * 100)
      : 0;

  const refereeIds = new Set((stats?.refereeTournaments ?? []).map((t) => t.id));
  const availableTournaments = (tournaments ?? []).filter(
    (t) =>
      !refereeIds.has(t.id) &&
      t.status !== 'completed' &&
      t.status !== 'cancelled',
  );

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link to="/users" className="hover:text-gray-700">
          Пользователи
        </Link>
        <span>/</span>
        <span className="text-gray-900">{fullName}</span>
        {isMe && <span className="text-xs text-gray-400">(вы)</span>}
      </div>

      {/* Profile + role */}
      <div className={card}>
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">{fullName}</h2>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
              user.role === 'admin'
                ? 'bg-purple-100 text-purple-700'
                : 'bg-gray-100 text-gray-700'
            }`}
          >
            {user.role === 'admin' ? 'Администратор' : 'Пользователь'}
          </span>
        </div>

        <div className="space-y-2">
          <InfoRow label="Username" value={`@${user.username}`} />
          <InfoRow label="Telegram ID" value={user.telegram_id ?? '—'} />
          <InfoRow label="Email" value={user.email ?? '—'} />
          <InfoRow label="Телефон" value={user.phone ?? '—'} />
        </div>

        {!isMe && (
          <button
            onClick={() => {
              const newRole = user.role === 'admin' ? 'user' : 'admin';
              const label =
                newRole === 'admin'
                  ? 'сделать администратором'
                  : 'снять права администратора';
              if (confirm(`${user.username}: ${label}?`))
                roleMutation.mutate(newRole);
            }}
            disabled={roleMutation.isPending}
            className={`mt-4 text-sm disabled:opacity-50 ${
              user.role === 'admin'
                ? 'text-red-500 hover:text-red-700'
                : 'text-blue-500 hover:text-blue-700'
            }`}
          >
            {user.role === 'admin'
              ? 'Снять права администратора'
              : 'Сделать администратором'}
          </button>
        )}

        {!isMe && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <button
              onClick={() => setShowDeleteModal(true)}
              disabled={deleteMutation.isPending}
              className="text-sm text-red-500 hover:text-red-700 disabled:opacity-50"
            >
              Удалить пользователя
            </button>
          </div>
        )}
      </div>

      {/* Edit name / surname — view mode with pencil, edit mode with inputs */}
      <div className={`${card} relative`}>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">
          Имя и фамилия
        </h3>

        {!isEditing && (
          <button
            onClick={() => {
              setFormError(null);
              setName(user.name ?? '');
              setSurname(user.surname ?? '');
              setIsEditing(true);
            }}
            aria-label="Редактировать"
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-700"
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
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
          </button>
        )}

        {formError && (
          <div className="mb-3 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-200">
            {formError}
          </div>
        )}

        {isEditing ? (
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Имя</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={50}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Фамилия
              </label>
              <input
                value={surname}
                onChange={(e) => setSurname(e.target.value)}
                maxLength={100}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => updateMutation.mutate()}
                disabled={updateMutation.isPending}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                Сохранить
              </button>
              <button
                onClick={() => {
                  setIsEditing(false);
                  setFormError(null);
                  setName(user.name ?? '');
                  setSurname(user.surname ?? '');
                }}
                disabled={updateMutation.isPending}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50"
              >
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <InfoRow label="Имя" value={user.name ?? '—'} />
            <InfoRow label="Фамилия" value={user.surname ?? '—'} />
          </div>
        )}
      </div>

      {/* Match statistics */}
      <div className={card}>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">
          Статистика матчей
        </h3>
        {stats && stats.matches.played > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatBox label="Сыграно" value={stats.matches.played} />
            <StatBox label="Победы" value={stats.matches.wins} />
            <StatBox label="Поражения" value={stats.matches.losses} />
            <StatBox label="Win-rate" value={`${winRate}%`} />
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            Ещё не сыграно ни одного матча.
          </p>
        )}
      </div>

      {/* Tournament history */}
      <div className={card}>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">
          История турниров
        </h3>
        {stats && stats.tournamentHistory.length > 0 ? (
          <ul className="space-y-2">
            {stats.tournamentHistory.map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-sm">
                <span>{t.isWinner ? '🏆' : '▫️'}</span>
                <Link
                  to={`/tournaments/${t.id}`}
                  className="text-blue-600 hover:text-blue-800"
                >
                  {t.name}
                </Link>
                <span className="text-xs text-gray-400">
                  {new Date(t.completedAt).toLocaleDateString('ru-RU')}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">Нет завершённых турниров.</p>
        )}
      </div>

      {/* Referee management */}
      <div className={card}>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Судейство</h3>
        {stats && stats.refereeTournaments.length > 0 ? (
          <ul className="space-y-2 mb-4">
            {stats.refereeTournaments.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <Link
                  to={`/tournaments/${t.id}`}
                  className="text-blue-600 hover:text-blue-800"
                >
                  {t.name}
                </Link>
                <button
                  onClick={() => removeMutation.mutate(t.id)}
                  disabled={removeMutation.isPending}
                  className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                >
                  Снять
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500 mb-4">
            Не назначен судьёй ни на один турнир.
          </p>
        )}

        <div className="flex items-center gap-2">
          <select
            value={selectedTournament}
            onChange={(e) => setSelectedTournament(e.target.value)}
            className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Выберите турнир…</option>
            {availableTournaments.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => assignMutation.mutate(selectedTournament)}
            disabled={!selectedTournament || assignMutation.isPending}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            Назначить судьёй
          </button>
        </div>
      </div>

      {/* Delete confirmation */}
      {showDeleteModal && !isMe && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900">
                Удалить пользователя
              </h3>
              <button
                onClick={() => setShowDeleteModal(false)}
                disabled={deleteMutation.isPending}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none disabled:opacity-50"
              >
                ×
              </button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-600">
                Удалить пользователя{' '}
                <span className="font-medium text-gray-900">
                  {user.username}
                </span>
                ? Аккаунт будет анонимизирован: личные данные удалятся, а в
                прошлых матчах и турнирах он будет отображаться как «Удалённый
                аккаунт». История сохранится.
              </p>

              {deleteMutation.error && (
                <p className="text-xs text-red-600">
                  {deleteMutation.error.message}
                </p>
              )}

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowDeleteModal(false)}
                  disabled={deleteMutation.isPending}
                  className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50"
                >
                  Отмена
                </button>
                <button
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                  className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  {deleteMutation.isPending ? 'Удаление...' : 'Удалить'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
