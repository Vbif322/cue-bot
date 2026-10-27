import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { usersApi } from '../lib/api.ts';

/** `YYYY-MM-DD` в локальной зоне — значение для `<input type="date">`. */
function toDateInput(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${String(date.getFullYear())}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + months);
  return d;
}

/**
 * Платное право организатора (`users.organizerUntil`) — только для
 * платформенного админа. Пока срок не истёк, пользователь создаёт свои
 * организации, а организации, где он владелец, — новые турниры. По истечении
 * текущие турниры доигрываются, новые не создаются. Лимиты тарифа — сколько
 * организаций он заводит сам и сколько турниров в месяц суммарно создают
 * организации, где он владелец.
 */
export default function OrganizerGrantCard({
  userId,
  organizerUntil,
  maxFederations,
  maxTournamentsPerMonth,
}: {
  userId: string;
  organizerUntil: string | null;
  maxFederations: number;
  maxTournamentsPerMonth: number;
}) {
  const qc = useQueryClient();
  const current = organizerUntil ? new Date(organizerUntil) : null;
  const active = current !== null && current > new Date();
  // Продление считаем от текущего срока, если он ещё идёт, иначе — от сегодня.
  const base = active ? current : new Date();
  const [date, setDate] = useState(() => toDateInput(addMonths(base, 1)));
  const [error, setError] = useState<string | null>(null);
  const [fedLimit, setFedLimit] = useState(String(maxFederations));
  const [tourLimit, setTourLimit] = useState(String(maxTournamentsPerMonth));

  const { data: usage } = useQuery({
    queryKey: ['user-organizer-usage', userId],
    queryFn: () => usersApi.organizerUsage(userId),
  });

  const limitsMutation = useMutation({
    mutationFn: (limits: {
      maxFederations: number;
      maxTournamentsPerMonth: number;
    }) => usersApi.setOrganizerLimits(userId, limits),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['user', userId] });
      void qc.invalidateQueries({
        queryKey: ['user-organizer-usage', userId],
      });
    },
    onError: (e: Error) => setError(e.message),
  });

  const parsedFed = Number(fedLimit);
  const parsedTour = Number(tourLimit);
  const limitsValid =
    fedLimit !== '' &&
    tourLimit !== '' &&
    Number.isInteger(parsedFed) &&
    Number.isInteger(parsedTour) &&
    parsedFed >= 0 &&
    parsedTour >= 0;
  const limitsChanged =
    parsedFed !== maxFederations || parsedTour !== maxTournamentsPerMonth;

  const mutation = useMutation({
    mutationFn: (until: string | null) =>
      usersApi.setOrganizerUntil(userId, until),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['user', userId] });
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  // Действует до конца выбранного дня (локальное время админа).
  const submit = () => {
    if (!date) return;
    mutation.mutate(new Date(`${date}T23:59:59`).toISOString());
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900">
          Право организатора
        </h3>
        <span
          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
            active
              ? 'bg-green-100 text-green-700'
              : current
                ? 'bg-amber-100 text-amber-700'
                : 'bg-gray-100 text-gray-600'
          }`}
        >
          {active
            ? `до ${current.toLocaleDateString('ru-RU')}`
            : current
              ? `истекло ${current.toLocaleDateString('ru-RU')}`
              : 'не выдано'}
        </span>
      </div>
      <p className="text-xs text-gray-500 mb-3">
        Платная опция: пока срок действует, пользователь создаёт свои
        организации и турниры в них. После окончания текущие турниры
        доигрываются, новые создать нельзя.
      </p>

      {error && (
        <div className="mb-3 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-200">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          aria-label="Действует до"
          value={date}
          min={toDateInput(new Date())}
          onChange={(e) => setDate(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {[
          { label: '+1 мес.', months: 1 },
          { label: '+1 год', months: 12 },
        ].map((o) => (
          <button
            key={o.months}
            type="button"
            onClick={() => setDate(toDateInput(addMonths(base, o.months)))}
            className="px-2 py-2 text-xs text-gray-600 hover:text-blue-700"
          >
            {o.label}
          </button>
        ))}
        <button
          onClick={submit}
          disabled={mutation.isPending || !date}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {active ? 'Продлить' : 'Выдать'}
        </button>
        {current && (
          <button
            onClick={() => {
              if (confirm('Снять право организатора?')) mutation.mutate(null);
            }}
            disabled={mutation.isPending}
            className="px-3 py-2 text-sm text-red-500 hover:text-red-700 disabled:opacity-50"
          >
            Снять
          </button>
        )}
      </div>

      <div className="mt-5 pt-4 border-t border-gray-100">
        <h4 className="text-sm font-semibold text-gray-900 mb-1">
          Лимиты тарифа
        </h4>
        <p className="text-xs text-gray-500 mb-3">
          Турниры считаются за календарный месяц суммарно по всем организациям,
          где пользователь владелец. Удалённые турниры место освобождают.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-gray-600">
            Организаций
            {usage && (
              <span className="ml-1 text-gray-400">
                (сейчас {usage.federations})
              </span>
            )}
            <input
              type="number"
              min={0}
              step={1}
              value={fedLimit}
              onChange={(e) => setFedLimit(e.target.value)}
              className="mt-1 block w-28 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <label className="text-xs text-gray-600">
            Турниров в месяц
            {usage && (
              <span className="ml-1 text-gray-400">
                (в этом {usage.tournamentsThisMonth})
              </span>
            )}
            <input
              type="number"
              min={0}
              step={1}
              value={tourLimit}
              onChange={(e) => setTourLimit(e.target.value)}
              className="mt-1 block w-28 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <button
            onClick={() =>
              limitsMutation.mutate({
                maxFederations: parsedFed,
                maxTournamentsPerMonth: parsedTour,
              })
            }
            disabled={
              limitsMutation.isPending || !limitsValid || !limitsChanged
            }
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}
