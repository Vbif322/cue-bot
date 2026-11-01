// Турнир в пульте: вкладки «Столы» / «Очередь» / «Матчи». Всё из одного
// поллинга доски (GET /referee/tournaments/:id/board). В режиме per_match
// столы и очередь не используются — только список матчей.
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TournamentStatusBadge } from '@cue-bot/ui';
import { refereeApi } from '../../lib/api.ts';
import type { AppMatch, RefereeBoard, RefereeTable } from '../../lib/types.ts';
import {
  callCountdown,
  hasBothPlayers,
  holderOf,
  isCalled,
  isOverdue,
  makeBlockers,
  matchStageLabel,
  maxWinnersRound,
  moveId,
  disputerName,
  queueOf,
  slotName,
} from '../../lib/refereeLogic.ts';
import { useNow, useRefereeTitle } from '../../lib/useReferee.ts';
import { displayName, formatDateTime } from '../../lib/format.ts';
import AppModal from '../../components/AppModal.tsx';
import { Btn, Chip } from '../../components/controls.tsx';
import { EmptyState, ErrorBox, Loader } from '../../components/ui.tsx';
import {
  Actions,
  BackLink,
  Card,
  MatchLink,
  MatchPlayers,
  Page,
  Pill,
  SectionTitle,
} from './parts.tsx';

type Tab = 'tables' | 'queue' | 'matches';

const TAB_LABELS: Record<Tab, string> = {
  tables: 'Столы',
  queue: 'Очередь',
  matches: 'Матчи',
};

function useBoard(tournamentId: string) {
  return useQuery({
    queryKey: ['referee', 'board', tournamentId],
    queryFn: () => refereeApi.board(tournamentId),
    refetchInterval: 15_000,
  });
}

/** Мутация пульта: по успеху и ошибке обновляет доску и главную. */
function useBoardAction<V>(
  tournamentId: string,
  fn: (vars: V) => Promise<unknown>,
) {
  const qc = useQueryClient();
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['referee', 'board', tournamentId] }),
      qc.invalidateQueries({ queryKey: ['referee', 'overview'] }),
    ]);
  return useMutation({
    mutationFn: fn,
    onSuccess: refresh,
    onError: refresh,
  });
}

function stageOf(board: RefereeBoard) {
  const maxRound = maxWinnersRound(board.matches);
  return (m: AppMatch) => matchStageLabel(m, board.tournament.format, maxRound);
}

// ── Столы ────────────────────────────────────────────────────────────────────

function TablesTab({
  board,
  now,
  running,
  onCall,
}: {
  board: RefereeBoard;
  now: number;
  /** Турнир идёт: вне его действия у столов не показываем — сервер их отклонит. */
  running: boolean;
  onCall: (table: RefereeTable) => void;
}) {
  const tid = board.tournament.id;
  const stage = stageOf(board);
  const action = useBoardAction(
    tid,
    ({
      kind,
      matchId,
    }: {
      kind: 'start' | 'extend' | 'postpone';
      matchId: string;
    }) =>
      kind === 'start'
        ? refereeApi.start(matchId)
        : kind === 'extend'
          ? refereeApi.extendCall(matchId)
          : refereeApi.postpone(matchId),
  );

  if (board.tables.length === 0) {
    return (
      <EmptyState
        title="К турниру не привязаны столы"
        hint="Столы назначает администратор в настройках турнира."
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {action.error && <ErrorBox message={action.error.message} />}
      {board.tables.map((table) => {
        const m = holderOf(board, table.id);
        return (
          <Card key={table.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>
                {table.name}
              </span>
              {!m && <Pill tone="success">Свободен</Pill>}
              {m && isCalled(m) && (
                <Pill tone={isOverdue(m, now) ? 'danger' : 'warning'}>
                  Вызов · {callCountdown(m, now)}
                </Pill>
              )}
              {m && m.disputedAt !== null && <Pill tone="danger">Спор</Pill>}
              {m?.status === 'in_progress' && m.disputedAt === null && (
                <Pill tone="info">Идёт</Pill>
              )}
              {m?.status === 'pending_confirmation' &&
                m.disputedAt === null && (
                  <Pill tone="warning">Ждёт подтверждения</Pill>
                )}
              {m && m.status === 'scheduled' && !isCalled(m) && (
                <Pill>Закреплён</Pill>
              )}
            </div>

            {m ? (
              <>
                <Link
                  to={`/referee/m/${m.id}`}
                  style={{ textDecoration: 'none', color: 'inherit' }}
                >
                  <MatchPlayers match={m} />
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-faint)',
                      marginTop: 4,
                    }}
                  >
                    {stage(m)}
                    {isCalled(m) &&
                      ` · у стола: ${
                        [
                          m.player1ReadyAt ? slotName(m, 1) : null,
                          m.player2ReadyAt ? slotName(m, 2) : null,
                        ]
                          .filter(Boolean)
                          .join(', ') || 'никого'
                      }`}
                  </div>
                </Link>
                <Actions>
                  {running && isCalled(m) && (
                    <>
                      <Btn
                        size="sm"
                        disabled={action.isPending}
                        onClick={() =>
                          action.mutate({ kind: 'start', matchId: m.id })
                        }
                      >
                        Начать
                      </Btn>
                      <Btn
                        size="sm"
                        variant="ghost"
                        disabled={action.isPending}
                        onClick={() =>
                          action.mutate({ kind: 'extend', matchId: m.id })
                        }
                      >
                        +5 мин
                      </Btn>
                      <Btn
                        size="sm"
                        variant="ghost"
                        disabled={action.isPending}
                        onClick={() =>
                          action.mutate({ kind: 'postpone', matchId: m.id })
                        }
                      >
                        Отложить
                      </Btn>
                    </>
                  )}
                  {!isCalled(m) && (
                    <Link
                      to={`/referee/m/${m.id}`}
                      className="cb-btn cb-btn-ghost cb-btn-sm"
                    >
                      {m.status === 'scheduled' ? 'Открыть' : 'Счёт'}
                    </Link>
                  )}
                </Actions>
              </>
            ) : (
              running && (
                <Actions>
                  <Btn size="sm" onClick={() => onCall(table)}>
                    Вызвать матч
                  </Btn>
                </Actions>
              )
            )}
          </Card>
        );
      })}
    </div>
  );
}

/** Выбор матча из очереди для свободного стола. */
function CallPicker({
  board,
  table,
  onClose,
}: {
  board: RefereeBoard;
  table: RefereeTable;
  onClose: () => void;
}) {
  const tid = board.tournament.id;
  const stage = stageOf(board);
  const blockers = makeBlockers(board);
  const candidates = queueOf(board).filter(hasBothPlayers);
  const call = useBoardAction(tid, (matchId: string) =>
    refereeApi.call(matchId, table.id),
  );

  return (
    <AppModal
      onClose={onClose}
      title={`Вызвать к столу «${table.name}»`}
      subtitle="Матчи в порядке очереди"
    >
      <div
        style={{
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {call.error && <ErrorBox message={call.error.message} />}
        {candidates.length === 0 && (
          <div style={{ fontSize: 14, color: 'var(--text-faint)' }}>
            Нет матчей с известными игроками, ожидающих стол.
          </div>
        )}
        {candidates.map((m) => {
          const notes = blockers(m);
          return (
            <button
              key={m.id}
              type="button"
              disabled={call.isPending}
              onClick={() => call.mutate(m.id, { onSuccess: onClose })}
              className="cb-card-link"
              style={{
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                minHeight: 52,
                padding: '10px 12px',
                borderRadius: 12,
                border: '1px solid var(--border-subtle)',
                background: 'var(--surface-inset)',
                color: 'inherit',
                fontFamily: 'inherit',
                cursor: 'pointer',
                opacity: notes.length > 0 ? 0.65 : 1,
              }}
            >
              <MatchPlayers match={m} />
              <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                {stage(m)}
                {notes.length > 0 && (
                  <span style={{ color: 'var(--color-tone-warning-fg)' }}>
                    {' · '}
                    {notes.join(', ')}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </AppModal>
  );
}

// ── Очередь ──────────────────────────────────────────────────────────────────

function QueueTab({ board }: { board: RefereeBoard }) {
  const tid = board.tournament.id;
  const stage = stageOf(board);
  const blockers = makeBlockers(board);
  const queue = queueOf(board);
  const reorder = useBoardAction(
    tid,
    ({ ids, expected }: { ids: string[]; expected: string[] }) =>
      refereeApi.setQueue(tid, ids, expected),
  );
  const present = useBoardAction(tid, (userId: string) =>
    refereeApi.markPresent(tid, userId),
  );
  const move = (from: number, to: number) => {
    const expected = queue.map((m) => m.id);
    reorder.mutate({ ids: moveId(expected, from, to), expected });
  };
  const error = reorder.error ?? present.error;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {error && <ErrorBox message={error.message} />}

      {board.absent.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <SectionTitle hint="Не пришли по вызову. Их матчи не получают стол, пока игрок не отметится сам или вы не отметите его здесь.">
            Отсутствуют ({board.absent.length})
          </SectionTitle>
          {board.absent.map((p) => (
            <Card
              key={p.userId}
              style={{ flexDirection: 'row', alignItems: 'center' }}
            >
              <span style={{ flex: 1, fontSize: 15, fontWeight: 600 }}>
                {displayName(p)}
              </span>
              <Btn
                size="sm"
                variant="ghost"
                disabled={present.isPending}
                onClick={() => present.mutate(p.userId)}
              >
                На месте
              </Btn>
            </Card>
          ))}
        </section>
      )}

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <SectionTitle hint="Свободный стол получает первый матч, где оба игрока известны, на месте и не заняты за другим столом.">
          Очередь на столы ({queue.length})
        </SectionTitle>
        {queue.length === 0 && (
          <div style={{ fontSize: 14, color: 'var(--text-faint)' }}>
            Нет матчей, ожидающих стол.
          </div>
        )}
        {queue.map((m, i) => {
          const notes = [
            ...(hasBothPlayers(m) ? [] : ['ждёт соперника']),
            ...blockers(m),
          ];
          return (
            <div
              key={m.id}
              style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}
            >
              <span
                style={{
                  width: 22,
                  alignSelf: 'center',
                  textAlign: 'right',
                  fontSize: 13,
                  color: 'var(--text-faint)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {i + 1}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <MatchLink
                  match={m}
                  right={<span />}
                  notes={
                    <>
                      <span>{stage(m)}</span>
                      {notes.length > 0 && (
                        <span style={{ color: 'var(--color-tone-warning-fg)' }}>
                          {notes.join(' · ')}
                        </span>
                      )}
                    </>
                  }
                />
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  justifyContent: 'center',
                }}
              >
                <Btn
                  size="sm"
                  variant="ghost"
                  aria-label="Поставить первым"
                  disabled={reorder.isPending || i === 0}
                  onClick={() => move(i, 0)}
                >
                  ⤒
                </Btn>
                <div style={{ display: 'flex', gap: 4 }}>
                  <Btn
                    size="sm"
                    variant="ghost"
                    aria-label="Выше"
                    disabled={reorder.isPending || i === 0}
                    onClick={() => move(i, i - 1)}
                  >
                    ↑
                  </Btn>
                  <Btn
                    size="sm"
                    variant="ghost"
                    aria-label="Ниже"
                    disabled={reorder.isPending || i === queue.length - 1}
                    onClick={() => move(i, i + 1)}
                  >
                    ↓
                  </Btn>
                </div>
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}

// ── Матчи ────────────────────────────────────────────────────────────────────

function MatchesTab({ board, now }: { board: RefereeBoard; now: number }) {
  const stage = stageOf(board);
  const perMatch = board.tournament.scheduleMode === 'per_match';
  const active = board.matches;

  const groups: { title: string; list: AppMatch[] }[] = [
    { title: 'Спорные', list: active.filter((m) => m.disputedAt !== null) },
    {
      title: 'Ждут подтверждения',
      list: active.filter(
        (m) => m.status === 'pending_confirmation' && m.disputedAt === null,
      ),
    },
    {
      title: 'Идут',
      list: active.filter(
        (m) => m.status === 'in_progress' && m.disputedAt === null,
      ),
    },
    { title: 'Вызваны к столу', list: active.filter(isCalled) },
    {
      title: 'Запланированы',
      list: active
        .filter((m) => m.status === 'scheduled' && !isCalled(m))
        .sort((a, b) =>
          perMatch
            ? (a.scheduledAt ?? '~').localeCompare(b.scheduledAt ?? '~')
            : a.round - b.round || a.position - b.position,
        ),
    },
    { title: 'Последние результаты', list: board.recent },
  ];

  if (groups.every((g) => g.list.length === 0)) {
    return <EmptyState title="Матчей нет" />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {groups
        .filter((g) => g.list.length > 0)
        .map((g) => (
          <section
            key={g.title}
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <SectionTitle>
              {g.title} ({g.list.length})
            </SectionTitle>
            {g.list.map((m) => (
              <MatchLink
                key={m.id}
                match={m}
                notes={
                  <>
                    <span>{stage(m)}</span>
                    {m.tableName && <span>· {m.tableName}</span>}
                    {perMatch && m.status === 'scheduled' && (
                      <span>
                        ·{' '}
                        {m.scheduledAt
                          ? formatDateTime(m.scheduledAt)
                          : 'время не назначено'}
                      </span>
                    )}
                    {isCalled(m) && (
                      <span style={{ color: 'var(--color-tone-warning-fg)' }}>
                        · {callCountdown(m, now)}
                      </span>
                    )}
                    {m.disputedAt !== null && (
                      <span style={{ color: 'var(--color-tone-danger-fg)' }}>
                        · оспорил {disputerName(m) ?? 'игрок'}
                        {m.disputedScore ? ` ${m.disputedScore}` : ''}
                      </span>
                    )}
                    {m.isTechnicalResult && <span>· тех. результат</span>}
                  </>
                }
              />
            ))}
          </section>
        ))}
    </div>
  );
}

// ── Страница ─────────────────────────────────────────────────────────────────

export default function RefereeTournamentPage() {
  const { tournamentId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { data: board, isLoading, error } = useBoard(tournamentId);
  const now = useNow();
  const [callTable, setCallTable] = useState<RefereeTable | null>(null);
  useRefereeTitle(board?.tournament.name);

  if (isLoading) return <Loader />;
  if (!board) {
    return (
      <Page>
        <BackLink to="/referee" label="Пульт" />
        <ErrorBox message={error?.message ?? 'Турнир не найден'} />
      </Page>
    );
  }

  const { tournament } = board;
  const tabs: Tab[] =
    tournament.scheduleMode === 'per_match'
      ? ['matches']
      : ['tables', 'queue', 'matches'];
  const requested = params.get('tab') as Tab | null;
  const tab: Tab =
    requested && tabs.includes(requested) ? requested : (tabs[0] ?? 'matches');
  const running = tournament.status === 'in_progress';

  return (
    <Page>
      <BackLink to="/referee" label="Пульт" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: 20, fontWeight: 700 }}>
          {tournament.name}
        </div>
        <TournamentStatusBadge status={tournament.status} />
      </div>
      <Link
        to={`/tournaments/${tournament.id}/bracket`}
        style={{ fontSize: 13, color: 'var(--accent-fg)', marginTop: -10 }}
      >
        Сетка турнира →
      </Link>

      {error && <ErrorBox message={error.message} />}
      {!running && (
        <ErrorBox message="Турнир не идёт — действия судьи недоступны." />
      )}

      {tabs.length > 1 && (
        <div className="cb-chips" style={{ display: 'flex', gap: 8 }}>
          {tabs.map((t) => (
            <Chip
              key={t}
              active={t === tab}
              onClick={() => setParams({ tab: t }, { replace: true })}
            >
              {TAB_LABELS[t]}
            </Chip>
          ))}
        </div>
      )}

      {tab === 'tables' && (
        <TablesTab
          board={board}
          now={now}
          running={running}
          onCall={setCallTable}
        />
      )}
      {tab === 'queue' && <QueueTab board={board} />}
      {tab === 'matches' && <MatchesTab board={board} now={now} />}

      {callTable && (
        <CallPicker
          board={board}
          table={callTable}
          onClose={() => setCallTable(null)}
        />
      )}
    </Page>
  );
}
