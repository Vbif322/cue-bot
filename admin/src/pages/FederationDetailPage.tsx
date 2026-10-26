import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, Input, Select } from '@cue-bot/ui';

import { federationsApi } from '../lib/api.ts';
import type { FederationRole } from '../lib/api.ts';
import { useFederation } from '../lib/federation.tsx';
import { useMe } from '../lib/useAuth.ts';

const ROLE_LABELS: Record<FederationRole, string> = {
  owner: 'Владелец',
  organizer: 'Организатор',
};

const card = 'bg-white rounded-xl border border-gray-200 p-5';

/**
 * Организация: настройки (имя, город, описание) и состав. Править может
 * владелец или платформенный админ; организатор только смотрит и может выйти.
 */
export default function FederationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { isPlatformAdmin } = useFederation();

  const { data: federation, isLoading } = useQuery({
    queryKey: ['federation', id],
    queryFn: () => federationsApi.get(id!),
    enabled: !!id,
  });
  const { data: members = [] } = useQuery({
    queryKey: ['federation-members', id],
    queryFn: () => federationsApi.members(id!),
    enabled: !!id,
  });
  const { data: chats = [] } = useQuery({
    queryKey: ['federation-chats', id],
    queryFn: () => federationsApi.chats(id!),
    enabled: !!id,
  });

  const [form, setForm] = useState({ name: '', city: '', description: '' });
  const [editing, setEditing] = useState(false);
  const [newMember, setNewMember] = useState('');
  const [newRole, setNewRole] = useState<FederationRole>('organizer');
  const [error, setError] = useState('');

  useEffect(() => {
    if (federation && !editing) {
      setForm({
        name: federation.name,
        city: federation.city,
        description: federation.description ?? '',
      });
    }
  }, [federation, editing]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['federation', id] });
    void qc.invalidateQueries({ queryKey: ['federation-members', id] });
    void qc.invalidateQueries({ queryKey: ['federation-chats', id] });
    void qc.invalidateQueries({ queryKey: ['federations'] });
    void qc.invalidateQueries({ queryKey: ['auth', 'me'] });
  };

  const save = useMutation({
    mutationFn: () =>
      federationsApi.update(id!, {
        name: form.name.trim(),
        city: form.city.trim(),
        description: form.description.trim() || null,
      }),
    onSuccess: () => {
      setEditing(false);
      setError('');
      invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });

  const addMember = useMutation({
    mutationFn: () =>
      federationsApi.addMember(id!, {
        username: newMember.trim(),
        role: newRole,
      }),
    onSuccess: () => {
      setNewMember('');
      setError('');
      invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });

  const setRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: FederationRole }) =>
      federationsApi.setMemberRole(id!, userId, role),
    onSuccess: () => {
      setError('');
      invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => federationsApi.removeMember(id!, userId),
    onSuccess: (_, userId) => {
      setError('');
      invalidate();
      if (userId === me?.user?.id && !isPlatformAdmin) navigate('/federations');
    },
    onError: (e: Error) => setError(e.message),
  });

  const toggleChat = useMutation({
    mutationFn: ({ chatId, bound }: { chatId: string; bound: boolean }) =>
      bound
        ? federationsApi.unbindChat(id!, chatId)
        : federationsApi.bindChat(id!, chatId),
    onSuccess: () => {
      setError('');
      invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: () => federationsApi.delete(id!),
    onSuccess: () => {
      invalidate();
      navigate('/federations');
    },
    onError: (e: Error) => setError(e.message),
  });

  if (isLoading || !federation || !id) {
    return <div className="text-gray-500 text-sm">Загрузка...</div>;
  }

  const canManage = isPlatformAdmin || federation.role === 'owner';

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link to="/federations" className="hover:text-gray-700">
          Организации
        </Link>
        <span>/</span>
        <span className="text-gray-900">{federation.name}</span>
      </div>

      {error && (
        <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg">
          {error}
        </div>
      )}

      <div className={card}>
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            {federation.name}
          </h2>
          {federation.role && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
              {ROLE_LABELS[federation.role]}
            </span>
          )}
        </div>

        {editing ? (
          <div className="space-y-3">
            <Input
              value={form.name}
              onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
              placeholder="Название *"
            />
            <Input
              value={form.city}
              onChange={(e) => setForm((s) => ({ ...s, city: e.target.value }))}
              placeholder="Город *"
            />
            <Input
              value={form.description}
              onChange={(e) =>
                setForm((s) => ({ ...s, description: e.target.value }))
              }
              placeholder="Описание"
            />
            <div className="flex gap-2">
              <Button
                onClick={() => save.mutate()}
                disabled={
                  !form.name.trim() || !form.city.trim() || save.isPending
                }
              >
                Сохранить
              </Button>
              <Button variant="secondary" onClick={() => setEditing(false)}>
                Отмена
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-1 text-sm">
            <p>
              <span className="text-gray-500">Город: </span>
              {federation.city}
            </p>
            <p>
              <span className="text-gray-500">Описание: </span>
              {federation.description ?? '—'}
            </p>
            {canManage && (
              <div className="flex gap-4 pt-3">
                <button
                  onClick={() => setEditing(true)}
                  className="text-sm text-blue-500 hover:text-blue-700"
                >
                  Изменить
                </button>
                {isPlatformAdmin && (
                  <button
                    onClick={() => {
                      if (confirm(`Удалить организацию «${federation.name}»?`))
                        remove.mutate();
                    }}
                    disabled={remove.isPending}
                    className="text-sm text-red-500 hover:text-red-700 disabled:opacity-50"
                  >
                    Удалить
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className={card}>
        <h3 className="text-base font-semibold text-gray-900 mb-3">Команда</h3>
        {members.length === 0 ? (
          <p className="text-sm text-gray-500">Пока никого</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {members.map((m) => {
              const isSelf = m.userId === me?.user?.id;
              return (
                <li
                  key={m.userId}
                  className="py-2 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {[m.name, m.surname].filter(Boolean).join(' ') ||
                        m.username}
                      {isSelf && (
                        <span className="ml-2 text-xs text-gray-400">(вы)</span>
                      )}
                    </p>
                    <p className="text-xs text-gray-500">@{m.username}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {canManage ? (
                      <Select
                        aria-label="Роль"
                        value={m.role}
                        onChange={(e) =>
                          setRole.mutate({
                            userId: m.userId,
                            role: e.target.value as FederationRole,
                          })
                        }
                        className="w-auto py-1"
                      >
                        <option value="owner">{ROLE_LABELS.owner}</option>
                        <option value="organizer">
                          {ROLE_LABELS.organizer}
                        </option>
                      </Select>
                    ) : (
                      <span className="text-xs text-gray-500">
                        {ROLE_LABELS[m.role]}
                      </span>
                    )}
                    {(canManage || isSelf) && (
                      <button
                        onClick={() => {
                          const label = isSelf
                            ? 'Выйти из организации?'
                            : `Исключить @${m.username}?`;
                          if (confirm(label)) removeMember.mutate(m.userId);
                        }}
                        disabled={removeMember.isPending}
                        className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                      >
                        {isSelf ? 'Выйти' : 'Исключить'}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {canManage && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newMember.trim()) addMember.mutate();
            }}
            className="mt-4 pt-4 border-t border-gray-100 flex flex-col sm:flex-row gap-2"
          >
            <Input
              value={newMember}
              onChange={(e) => setNewMember(e.target.value)}
              placeholder="@username (должен написать боту)"
            />
            <Select
              aria-label="Роль нового участника"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as FederationRole)}
              className="sm:w-44"
            >
              <option value="organizer">{ROLE_LABELS.organizer}</option>
              <option value="owner">{ROLE_LABELS.owner}</option>
            </Select>
            <Button
              type="submit"
              disabled={!newMember.trim() || addMember.isPending}
            >
              Добавить
            </Button>
          </form>
        )}
      </div>

      <div className={card}>
        <h3 className="text-base font-semibold text-gray-900 mb-1">
          Чаты для анонсов
        </h3>
        <p className="text-xs text-gray-500 mb-3">
          Привязанный чат получает анонсы только ваших турниров. Непривязанный
          слышит все публичные турниры. Чтобы чат появился здесь, добавьте бота
          в группу и выполните там /start_announcements.
        </p>
        {chats.length === 0 ? (
          <p className="text-sm text-gray-500">Подходящих чатов пока нет</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {chats.map((ch) => (
              <li
                key={ch.chatId}
                className="py-2 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {ch.title ?? ch.chatId}
                    {!ch.isActive && (
                      <span className="ml-2 text-xs text-gray-400">
                        (анонсы выключены)
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500">
                    {ch.bound
                      ? 'привязан к организации'
                      : 'не привязан — слышит всё'}
                  </p>
                </div>
                {canManage && (
                  <button
                    onClick={() =>
                      toggleChat.mutate({ chatId: ch.chatId, bound: ch.bound })
                    }
                    disabled={toggleChat.isPending}
                    className={`text-xs disabled:opacity-50 ${
                      ch.bound
                        ? 'text-red-500 hover:text-red-700'
                        : 'text-blue-500 hover:text-blue-700'
                    }`}
                  >
                    {ch.bound ? 'Отвязать' : 'Привязать'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
