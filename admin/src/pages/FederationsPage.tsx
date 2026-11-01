import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Button, Input } from '@cue-bot/ui';

import { federationsApi } from '../lib/api.ts';
import type { ApiFederationSummary, ApiUserFederation } from '../lib/api.ts';
import { useFederation } from '../lib/federation.tsx';

const ROLE_LABELS = { owner: 'Владелец', organizer: 'Организатор' } as const;

type Row = ApiFederationSummary | ApiUserFederation;

const isSummary = (r: Row): r is ApiFederationSummary => 'membersCount' in r;

/** Срок, до которого открыты новые турниры (право организатора владельцев). */
function ActiveUntil({ value }: { value: string | null }) {
  const until = value ? new Date(value) : null;
  if (until && until > new Date()) {
    return (
      <span className="text-gray-600">
        до {until.toLocaleDateString('ru-RU')}
      </span>
    );
  }
  return <span className="text-amber-700">закрыты</span>;
}

/**
 * Организации (федерации, клубы, частные организаторы). Платформенный админ видит
 * все и создаёт для других (владелец по @username); организатор — свои, а
 * создать новую может только при действующем праве организатора (платная опция).
 */
export default function FederationsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { isPlatformAdmin, canCreateFederations } = useFederation();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['federations'],
    queryFn: federationsApi.list,
  });

  const [form, setForm] = useState({
    name: '',
    city: '',
    description: '',
    ownerUsername: '',
  });
  const [error, setError] = useState('');

  const create = useMutation({
    mutationFn: () =>
      federationsApi.create({
        name: form.name.trim(),
        city: form.city.trim(),
        description: form.description.trim() || null,
        ...(isPlatformAdmin && form.ownerUsername.trim()
          ? { ownerUsername: form.ownerUsername.trim() }
          : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['federations'] });
      qc.invalidateQueries({ queryKey: ['auth', 'me'] });
      setForm({ name: '', city: '', description: '', ownerUsername: '' });
      setError('');
    },
    onError: (e: Error) => setError(e.message),
  });

  const canSubmit =
    form.name.trim() !== '' && form.city.trim() !== '' && !create.isPending;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Организации</h1>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg">
          {error}
        </div>
      )}

      {!canCreateFederations && (
        <div className="mb-6 p-3 bg-gray-50 text-gray-600 text-sm rounded-lg border border-gray-200">
          Создание организаций — платная опция. Чтобы завести свою организацию,
          обратитесь к администратору платформы.
        </div>
      )}

      {canCreateFederations && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) create.mutate();
          }}
          className="bg-white border border-gray-200 rounded-lg p-4 mb-6 space-y-3"
        >
          <h2 className="text-sm font-semibold text-gray-700">
            Новая организация
          </h2>
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
            placeholder="Описание (необязательно)"
          />
          {isPlatformAdmin && (
            <Input
              value={form.ownerUsername}
              onChange={(e) =>
                setForm((s) => ({ ...s, ownerUsername: e.target.value }))
              }
              placeholder="@username владельца (по умолчанию — вы)"
            />
          )}
          <Button type="submit" disabled={!canSubmit}>
            {create.isPending ? 'Создание...' : 'Создать'}
          </Button>
        </form>
      )}

      {isLoading ? (
        <div className="text-gray-500 text-sm">Загрузка...</div>
      ) : rows.length === 0 ? (
        <div className="text-gray-500 text-sm">Организаций пока нет</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600">
                  Название
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">
                  Город
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">
                  {isPlatformAdmin ? 'Команда / турниры' : 'Моя роль'}
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">
                  Новые турниры
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((f) => (
                <tr
                  key={f.id}
                  onClick={() => navigate(`/federations/${f.id}`)}
                  className="hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  <td className="px-4 py-3 font-medium text-blue-600">
                    {f.name}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{f.city}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {isSummary(f)
                      ? `${String(f.membersCount)} / ${String(f.tournamentsCount)}`
                      : ROLE_LABELS[f.role]}
                  </td>
                  <td className="px-4 py-3">
                    <ActiveUntil value={f.activeUntil} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
