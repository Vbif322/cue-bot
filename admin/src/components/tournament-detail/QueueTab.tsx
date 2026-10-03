import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { matchesApi } from '../../lib/api.ts';
import type { ApiMatch } from '../../lib/api.ts';
import { Button, MatchStatusBadge } from '@cue-bot/ui';
import { groupLetter, playoffRoundName } from '../../lib/tournamentLabels.ts';

/**
 * Same order the server's getNextReadyMatch uses: the admin-set queue first
 * (unset last), then bracket order.
 */
const byQueueOrder = (a: ApiMatch, b: ApiMatch): number =>
  (a.queueOrder ?? Infinity) - (b.queueOrder ?? Infinity) ||
  a.round - b.round ||
  a.position - b.position;

function roundLabel(m: ApiMatch, playoffMaxRound: number, isGroups: boolean) {
  if (m.phase === 'group') {
    return `Группа ${groupLetter(m.groupIndex ?? 0)} · Тур ${m.round}`;
  }
  const base = isGroups
    ? playoffRoundName(m.round, playoffMaxRound)
    : `R${m.round}`;
  return m.bracketType === 'losers' ? `${base} L` : base;
}

const playerName = (name: string | null, username: string | null): string =>
  name ?? username ?? 'TBD';

/** Statuses that keep a match's table taken (mirrors the server's onTableFreed). */
const HOLDS_TABLE = new Set<ApiMatch['status']>([
  'scheduled',
  'in_progress',
  'pending_confirmation',
]);

const byTableName = (a: ApiMatch, b: ApiMatch): number =>
  (a.tableName ?? '').localeCompare(b.tableName ?? '', 'ru', {
    numeric: true,
  });

function Players({ m }: { m: ApiMatch }) {
  return (
    <div className="text-sm text-gray-900 truncate">
      {playerName(m.player1Name, m.player1Username)}
      <span className="text-gray-400"> vs </span>
      {playerName(m.player2Name, m.player2Username)}
    </div>
  );
}

/**
 * «Очередь» tab: the matches holding a table, then the waiting matches
 * (`scheduled`, no table yet) in table queue order. A freed table goes to the
 * first waiting match whose players are both known and free — not at a table
 * here or in another running tournament; the admin reorders it with
 * ↑ / ↓ / «Первым».
 */
export default function QueueTab({ tournamentId }: { tournamentId: string }) {
  const qc = useQueryClient();
  const [error, setError] = useState('');

  // Shares the cache with MatchesTab, so switching tabs doesn't refetch.
  const { data, isLoading } = useQuery({
    queryKey: ['tournament-matches', tournamentId],
    queryFn: () => matchesApi.byTournament(tournamentId),
  });
  const matches = useMemo(() => data ?? [], [data]);

  const queue = useMemo(
    () =>
      matches
        .filter((m) => m.status === 'scheduled' && m.tableId === null)
        .sort(byQueueOrder),
    [matches],
  );

  const seated = useMemo(
    () =>
      matches
        .filter((m) => m.tableId !== null && HOLDS_TABLE.has(m.status))
        .sort(byTableName),
    [matches],
  );

  // Players at a table in another running tournament also block a match.
  const { data: busyElsewhere } = useQuery({
    queryKey: ['tournament-busy-elsewhere', tournamentId],
    queryFn: () => matchesApi.busyElsewhere(tournamentId),
  });

  const isGroups = matches.some((m) => m.phase === 'group');
  const playoffMaxRound = Math.max(
    0,
    ...matches.filter((m) => m.phase === 'playoff').map((m) => m.round),
  );
  const playingHere = new Set(
    matches
      .filter((m) => m.status === 'in_progress')
      .flatMap((m) => [m.player1Id, m.player2Id]),
  );
  const elsewhere = new Map(
    (busyElsewhere ?? []).map((b) => [b.userId, b.tournamentName]),
  );

  /** Why a waiting match can't be seated right now, one note per busy player. */
  const blockers = (m: ApiMatch): string[] =>
    [
      { id: m.player1Id, name: playerName(m.player1Name, m.player1Username) },
      { id: m.player2Id, name: playerName(m.player2Name, m.player2Username) },
    ].flatMap(({ id, name }) => {
      if (id === null) return [];
      if (playingHere.has(id)) return [`${name} играет`];
      const other = elsewhere.get(id);
      return other === undefined ? [] : [`${name} играет в «${other}»`];
    });

  const invalidate = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['tournament-matches', tournamentId] }),
      qc.invalidateQueries({
        queryKey: ['tournament-busy-elsewhere', tournamentId],
      }),
    ]);

  const reorder = useMutation({
    mutationFn: (matchIds: string[]) =>
      matchesApi.setQueue(tournamentId, matchIds),
    onSuccess: () => {
      setError('');
      return invalidate();
    },
    onError: (e: Error) => {
      setError(e.message);
      return invalidate();
    },
  });

  const move = (from: number, to: number): void => {
    const ids = queue.map((m) => m.id);
    const [id] = ids.splice(from, 1);
    if (id === undefined) return;
    ids.splice(to, 0, id);
    reorder.mutate(ids);
  };

  if (isLoading) {
    return <div className="text-gray-500 text-sm">Загрузка...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-4 py-3 border-b border-gray-200 text-sm font-semibold text-gray-800">
          За столами ({seated.length})
        </div>
        {seated.length === 0 && (
          <div className="text-center text-gray-400 py-6 text-sm">
            Сейчас никто не играет
          </div>
        )}
        <ul className="divide-y divide-gray-100">
          {seated.map((m) => (
            <li
              key={m.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5"
            >
              <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded whitespace-nowrap">
                {m.tableName ?? 'Стол'}
              </span>
              <div className="min-w-0 flex-1">
                <Players m={m} />
                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <span>{roundLabel(m, playoffMaxRound, isGroups)}</span>
                  <Link
                    to={`/matches/${m.id}`}
                    className="text-blue-500 hover:text-blue-700"
                  >
                    Управление
                  </Link>
                </div>
              </div>
              <MatchStatusBadge status={m.status} />
            </li>
          ))}
        </ul>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-4 py-3 border-b border-gray-200">
          <div className="text-sm font-semibold text-gray-800">
            Очередь на столы ({queue.length})
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            Свободный стол получает первый матч, в котором оба игрока известны и
            не играют за другим столом — в том числе в другом турнире.
          </div>
        </div>

        {queue.length === 0 && (
          <div className="text-center text-gray-400 py-8 text-sm">
            Нет матчей, ожидающих стол
          </div>
        )}

        {error && (
          <div className="mx-4 mt-3 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-200">
            {error}
          </div>
        )}

        <ol className="divide-y divide-gray-100">
          {queue.map((m, i) => {
            const hasTbd = m.player1Id === null || m.player2Id === null;
            return (
              <li
                key={m.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5"
              >
                <span className="w-6 text-right font-mono text-sm text-gray-400">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <Players m={m} />
                  <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    <span>{roundLabel(m, playoffMaxRound, isGroups)}</span>
                    {hasTbd && (
                      <span className="text-amber-600">ждёт соперника</span>
                    )}
                    {blockers(m).map((note) => (
                      <span key={note} className="text-amber-600">
                        {note}
                      </span>
                    ))}
                    <Link
                      to={`/matches/${m.id}`}
                      className="text-blue-500 hover:text-blue-700"
                    >
                      Управление
                    </Link>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <Button
                    variant="secondary"
                    size="sm"
                    title="Первым"
                    aria-label="Поставить первым"
                    disabled={reorder.isPending || i === 0}
                    onClick={() => move(i, 0)}
                  >
                    ⤒
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label="Выше"
                    disabled={reorder.isPending || i === 0}
                    onClick={() => move(i, i - 1)}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label="Ниже"
                    disabled={reorder.isPending || i === queue.length - 1}
                    onClick={() => move(i, i + 1)}
                  >
                    ↓
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
