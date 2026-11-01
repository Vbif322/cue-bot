// Матч в пульте судьи. Секции зависят от состояния: вызов к столу (явка,
// старт, +5 мин, отложить, неявка), ожидание (старт, вызов, стол, время),
// итоговый счёт (окончательный, без подтверждения игроков) и технический
// результат. Завершённый матч — только просмотр: исправляет админ.
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MatchStatusBadge, type FramePayload } from '@cue-bot/ui';
import { ApiError, refereeApi } from '../../lib/api.ts';
import type { AppMatch, RefereeMatchDetail } from '../../lib/types.ts';
import {
  callCountdown,
  hasBothPlayers,
  isActive,
  isCalled,
  isOverdue,
  isoToUtcInput,
  matchStageLabel,
  disputerName,
  nameById,
  scoreText,
  slotName,
  utcInputToIso,
} from '../../lib/refereeLogic.ts';
import { useNow, useRefereeTitle } from '../../lib/useReferee.ts';
import { formatDateTime } from '../../lib/format.ts';
import { Btn, Chip, Field } from '../../components/controls.tsx';
import { ErrorBox, Loader } from '../../components/ui.tsx';
import FramesReport from '../../components/FramesReport.tsx';
import {
  Actions,
  BackLink,
  Banner,
  Card,
  ConfirmDialog,
  Page,
  Pill,
  SectionTitle,
} from './parts.tsx';

type Slot = 1 | 2;

const TECH_REASONS = ['Решение судьи', 'Отказ от игры', 'Неявка соперника'];

const capitalize = (s: string): string =>
  s.charAt(0).toUpperCase() + s.slice(1);

function useMatchDetail(matchId: string) {
  return useQuery({
    queryKey: ['referee', 'match', matchId],
    queryFn: () => refereeApi.match(matchId),
    refetchInterval: (q) =>
      q.state.data && isActive(q.state.data.match) ? 10_000 : false,
  });
}

/** Мутация по матчу: обновляет карточку, доску турнира и главную пульта. */
function useMatchAction<V>(
  detail: RefereeMatchDetail,
  fn: (vars: V) => Promise<unknown>,
  onDone?: () => void,
) {
  const qc = useQueryClient();
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['referee', 'match', detail.match.id] }),
      qc.invalidateQueries({
        queryKey: ['referee', 'board', detail.tournament.id],
      }),
      qc.invalidateQueries({ queryKey: ['referee', 'overview'] }),
    ]);
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await refresh();
      onDone?.();
    },
    onError: refresh,
  });
}

// ── Табло ────────────────────────────────────────────────────────────────────

function ScoreRow({ match, slot }: { match: AppMatch; slot: Slot }) {
  const id = slot === 1 ? match.player1Id : match.player2Id;
  const score = slot === 1 ? match.player1Score : match.player2Score;
  const readyAt = slot === 1 ? match.player1ReadyAt : match.player2ReadyAt;
  const winner = id !== null && match.winnerId === id;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 17,
          fontWeight: winner ? 700 : 600,
          color: winner ? 'var(--text-primary)' : 'var(--text-secondary)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {slotName(match, slot)}
      </span>
      {isCalled(match) && id !== null && (
        <Pill tone={readyAt ? 'success' : undefined}>
          {readyAt ? '✓ у стола' : 'ждём'}
        </Pill>
      )}
      <span
        style={{
          width: 32,
          textAlign: 'right',
          fontSize: 24,
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          color: winner ? 'var(--text-primary)' : 'var(--text-faint)',
        }}
      >
        {score ?? '—'}
      </span>
    </div>
  );
}

// ── Вызов к столу ────────────────────────────────────────────────────────────

function CallSection({
  detail,
  now,
}: {
  detail: RefereeMatchDetail;
  now: number;
}) {
  const m = detail.match;
  const [noShow, setNoShow] = useState<Slot | null>(null);
  const navigate = useNavigate();
  const toTournament = () => navigate(`/referee/t/${detail.tournament.id}`);

  const act = useMatchAction(
    detail,
    (
      a:
        | { kind: 'ready'; slot: Slot }
        | { kind: 'start' | 'extend' | 'postpone' },
    ) => {
      switch (a.kind) {
        case 'ready':
          return refereeApi.ready(m.id, a.slot);
        case 'start':
          return refereeApi.start(m.id);
        case 'extend':
          return refereeApi.extendCall(m.id);
        case 'postpone':
          return refereeApi.postpone(m.id);
      }
    },
  );
  const noShowMut = useMatchAction(
    detail,
    (slot: Slot) => refereeApi.noShow(m.id, slot),
    toTournament,
  );

  const overdue = isOverdue(m, now);
  const winnerOf = (absent: Slot): Slot => (absent === 1 ? 2 : 1);

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Banner
        tone={overdue ? 'danger' : 'warning'}
        title={`Вызов к столу${m.tableName ? ` «${m.tableName}»` : ''}`}
      >
        {capitalize(callCountdown(m, now) ?? '')}. Матч начнётся, когда оба
        подтвердят явку, — или начните его сами.
      </Banner>
      {act.error && <ErrorBox message={act.error.message} />}

      {([1, 2] as const).map((slot) => {
        const readyAt = slot === 1 ? m.player1ReadyAt : m.player2ReadyAt;
        return (
          <Card
            key={slot}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
          >
            <span
              style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600 }}
            >
              {slotName(m, slot)}
            </span>
            {readyAt ? (
              <Pill tone="success">✓ у стола</Pill>
            ) : (
              <>
                <Btn
                  size="sm"
                  variant="ghost"
                  disabled={act.isPending}
                  onClick={() => act.mutate({ kind: 'ready', slot })}
                >
                  Явка
                </Btn>
                <Btn
                  size="sm"
                  variant="danger"
                  disabled={act.isPending}
                  onClick={() => setNoShow(slot)}
                >
                  Неявка
                </Btn>
              </>
            )}
          </Card>
        );
      })}

      <Actions>
        <Btn
          disabled={act.isPending}
          onClick={() => act.mutate({ kind: 'start' })}
        >
          Начать матч
        </Btn>
        <Btn
          variant="ghost"
          disabled={act.isPending}
          onClick={() => act.mutate({ kind: 'extend' })}
        >
          +5 мин
        </Btn>
        <Btn
          variant="ghost"
          disabled={act.isPending}
          onClick={() => act.mutate({ kind: 'postpone' })}
        >
          Отложить
        </Btn>
      </Actions>
      <div
        style={{ fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.45 }}
      >
        «Отложить» отдаёт стол следующему матчу, а неявившихся отмечает
        отсутствующими — очередь пропустит их матчи, пока они не вернутся.
      </div>

      {noShow !== null && (
        <ConfirmDialog
          title={`Неявка: ${slotName(m, noShow)}`}
          confirmLabel="Техническое поражение"
          danger
          pending={noShowMut.isPending}
          error={noShowMut.error?.message}
          onClose={() => {
            noShowMut.reset();
            setNoShow(null);
          }}
          onConfirm={() => noShowMut.mutate(noShow)}
        >
          Победа будет присуждена игроку {slotName(m, winnerOf(noShow))}.
          Неявившийся отмечается отсутствующим, пока не вернётся.
        </ConfirmDialog>
      )}
    </section>
  );
}

// ── Ожидание: старт, вызов, стол, время ──────────────────────────────────────

function WaitingSection({ detail }: { detail: RefereeMatchDetail }) {
  const m = detail.match;
  const [callTo, setCallTo] = useState('');
  const act = useMatchAction(
    detail,
    (a: { kind: 'start' } | { kind: 'call'; tableId: string }) =>
      a.kind === 'start'
        ? refereeApi.start(m.id)
        : refereeApi.call(m.id, a.tableId),
  );
  // Ошибка («Стол занят…») устаревает, как только матч изменился, например
  // стол забрали через блок «Стол».
  const { reset } = act;
  useEffect(() => reset(), [reset, m.tableId, m.updatedAt]);
  if (!hasBothPlayers(m)) return null;

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SectionTitle>Начало матча</SectionTitle>
      {act.error && <ErrorBox message={act.error.message} />}
      {detail.tables.length > 0 && (
        <div style={{ display: 'flex', gap: 8 }}>
          <select
            className="cb-field"
            aria-label="Стол для вызова"
            value={callTo}
            onChange={(e) => setCallTo(e.target.value)}
            style={{ flex: 1, minWidth: 0 }}
          >
            <option value="">Выберите стол…</option>
            {detail.tables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <Btn
            disabled={act.isPending || callTo === ''}
            onClick={() => act.mutate({ kind: 'call', tableId: callTo })}
          >
            Вызвать
          </Btn>
        </div>
      )}
      <Btn
        variant="ghost"
        block
        disabled={act.isPending}
        onClick={() => act.mutate({ kind: 'start' })}
      >
        Начать сразу, без вызова
      </Btn>
    </section>
  );
}

function TableSection({ detail }: { detail: RefereeMatchDetail }) {
  const m = detail.match;
  const [tableId, setTableId] = useState(m.tableId ?? '');
  const [conflict, setConflict] = useState<string | null>(null);
  useEffect(() => setTableId(m.tableId ?? ''), [m.tableId]);

  const save = useMatchAction(detail, (force: boolean) =>
    refereeApi.setTable(m.id, tableId === '' ? null : tableId, force),
  );
  const submit = (force: boolean) =>
    save.mutate(force, {
      onSuccess: () => setConflict(null),
      onError: (e) => {
        if (e instanceof ApiError && e.status === 409 && !force) {
          setConflict(e.message);
        }
      },
    });

  if (detail.tables.length === 0) return null;
  const changed = tableId !== (m.tableId ?? '');

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <SectionTitle hint="Закрепить стол без вызова. Снять стол — вернуть матч в очередь.">
        Стол
      </SectionTitle>
      {save.error && !conflict && <ErrorBox message={save.error.message} />}
      <div style={{ display: 'flex', gap: 8 }}>
        <select
          className="cb-field"
          aria-label="Стол"
          value={tableId}
          onChange={(e) => setTableId(e.target.value)}
          style={{ flex: 1, minWidth: 0 }}
        >
          <option value="">Без стола</option>
          {detail.tables.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <Btn
          variant="ghost"
          disabled={!changed || save.isPending}
          onClick={() => submit(false)}
        >
          Сохранить
        </Btn>
      </div>
      {conflict && (
        <ConfirmDialog
          title="Стол занят"
          confirmLabel="Забрать стол"
          danger
          pending={save.isPending}
          // Ошибка повторной попытки «забрать»; исходный 409 уже в тексте.
          error={save.variables === true ? save.error?.message : null}
          onClose={() => {
            save.reset();
            setConflict(null);
          }}
          onConfirm={() => submit(true)}
        >
          {conflict}. Если забрать стол, тот матч останется без стола (а
          вызванный — вернётся в очередь).
        </ConfirmDialog>
      )}
    </section>
  );
}

function ScheduleSection({ detail }: { detail: RefereeMatchDetail }) {
  const m = detail.match;
  const [value, setValue] = useState(isoToUtcInput(m.scheduledAt));
  useEffect(() => setValue(isoToUtcInput(m.scheduledAt)), [m.scheduledAt]);
  const save = useMatchAction(detail, (iso: string | null) =>
    refereeApi.setSchedule(m.id, iso),
  );

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <SectionTitle hint="Игроки получат уведомление о назначенном времени.">
        Время матча
      </SectionTitle>
      {save.error && <ErrorBox message={save.error.message} />}
      <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
        {m.scheduledAt ? formatDateTime(m.scheduledAt) : 'Не назначено'}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Field
          type="datetime-local"
          aria-label="Дата и время матча"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}
        />
        <Btn
          variant="ghost"
          disabled={save.isPending || utcInputToIso(value) === null}
          onClick={() => save.mutate(utcInputToIso(value))}
        >
          Назначить
        </Btn>
        {m.scheduledAt && (
          <Btn
            variant="ghost"
            disabled={save.isPending}
            onClick={() => save.mutate(null)}
          >
            Сбросить
          </Btn>
        )}
      </div>
    </section>
  );
}

// ── Итоговый счёт ────────────────────────────────────────────────────────────

function Stepper({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const btn = { width: 48, height: 48, padding: 0, fontSize: 22 };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <button
        type="button"
        onClick={() => onChange(max)}
        title="Победа"
        style={{
          flex: 1,
          minWidth: 0,
          textAlign: 'left',
          background: 'none',
          border: 'none',
          padding: 0,
          color:
            value === max ? 'var(--text-primary)' : 'var(--text-secondary)',
          fontFamily: 'inherit',
          fontSize: 15,
          fontWeight: value === max ? 700 : 600,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </button>
      <Btn
        variant="ghost"
        aria-label={`${label}: минус`}
        disabled={value <= 0}
        onClick={() => onChange(value - 1)}
        style={btn}
      >
        −
      </Btn>
      <span
        style={{
          width: 34,
          textAlign: 'center',
          fontSize: 26,
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
      <Btn
        variant="ghost"
        aria-label={`${label}: плюс`}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
        style={btn}
      >
        ＋
      </Btn>
    </div>
  );
}

type ResultInput =
  | { kind: 'score'; p1: number; p2: number }
  | { kind: 'frames'; frames: FramePayload[] };

function ResultSection({ detail }: { detail: RefereeMatchDetail }) {
  const m = detail.match;
  const { winScore } = detail;
  const isSnooker = detail.tournament.discipline.startsWith('snooker');
  const [score, setScore] = useState({ p1: 0, p2: 0 });
  const [pending, setPending] = useState<ResultInput | null>(null);
  const navigate = useNavigate();

  const save = useMatchAction(
    detail,
    (input: ResultInput) =>
      input.kind === 'score'
        ? refereeApi.result(m.id, input.p1, input.p2)
        : refereeApi.resultFrames(m.id, input.frames),
    () => navigate(`/referee/t/${detail.tournament.id}`),
  );

  const decided = (score.p1 === winScore) !== (score.p2 === winScore);
  const shown =
    pending?.kind === 'frames'
      ? pending.frames.reduce(
          (acc, f) =>
            f.player1Points > f.player2Points
              ? { ...acc, p1: acc.p1 + 1 }
              : { ...acc, p2: acc.p2 + 1 },
          { p1: 0, p2: 0 },
        )
      : pending;

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SectionTitle
        hint={`Окончательный результат: подтверждение игроков не нужно, победитель сразу проходит дальше. Матч до ${winScore}.`}
      >
        Итоговый счёт
      </SectionTitle>

      {isSnooker ? (
        <FramesReport
          match={m}
          winScore={winScore}
          title="Результат по фреймам"
          submitLabel="Зафиксировать результат"
          draftApi={{
            load: async () => (await refereeApi.match(m.id)).frames,
            saveFrame: (n, frame) => refereeApi.saveFrame(m.id, n, frame),
            deleteLastFrame: () => refereeApi.deleteLastFrame(m.id),
          }}
          submitting={save.isPending}
          onSubmit={(frames) => setPending({ kind: 'frames', frames })}
        />
      ) : (
        <Card>
          <Stepper
            label={slotName(m, 1)}
            value={score.p1}
            max={winScore}
            onChange={(p1) => setScore((s) => ({ ...s, p1 }))}
          />
          <Stepper
            label={slotName(m, 2)}
            value={score.p2}
            max={winScore}
            onChange={(p2) => setScore((s) => ({ ...s, p2 }))}
          />
          <Btn
            block
            disabled={!decided || save.isPending}
            onClick={() => setPending({ kind: 'score', ...score })}
          >
            Зафиксировать {score.p1}:{score.p2}
          </Btn>
          {!decided && (
            <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>
              Ровно один игрок должен набрать {winScore}. Нажмите на имя, чтобы
              отдать ему победу.
            </div>
          )}
        </Card>
      )}

      {pending && shown && (
        <ConfirmDialog
          title="Зафиксировать результат?"
          confirmLabel="Зафиксировать"
          pending={save.isPending}
          error={save.error?.message}
          onClose={() => {
            save.reset();
            setPending(null);
          }}
          onConfirm={() => save.mutate(pending)}
        >
          <b style={{ color: 'var(--text-primary)' }}>
            {slotName(m, 1)} {shown.p1} : {shown.p2} {slotName(m, 2)}
          </b>
          <br />
          Результат окончательный: игроки получат уведомление, победитель
          проходит дальше.
          {m.disputedAt !== null && ' Спор будет закрыт.'}
          {m.status === 'pending_confirmation' &&
            ' Внесённый игроком счёт будет заменён.'}
        </ConfirmDialog>
      )}
    </section>
  );
}

// ── Технический результат ────────────────────────────────────────────────────

function TechnicalSection({ detail }: { detail: RefereeMatchDetail }) {
  const m = detail.match;
  const [open, setOpen] = useState(false);
  const [winner, setWinner] = useState<Slot | null>(null);
  const [reason, setReason] = useState(TECH_REASONS[0] ?? '');
  const [custom, setCustom] = useState('');
  const navigate = useNavigate();
  const save = useMatchAction(
    detail,
    (a: { winner: Slot; reason: string }) =>
      refereeApi.technical(m.id, a.winner, a.reason),
    () => navigate(`/referee/t/${detail.tournament.id}`),
  );
  const finalReason = reason === 'other' ? custom.trim() : reason;

  const close = () => {
    save.reset();
    setOpen(false);
  };

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Btn variant="danger" block onClick={() => setOpen(true)}>
        Технический результат
      </Btn>
      {open && (
        <ConfirmDialog
          title="Технический результат"
          confirmLabel="Присудить победу"
          danger
          pending={save.isPending}
          confirmDisabled={winner === null || finalReason === ''}
          error={save.error?.message}
          onClose={close}
          onConfirm={() => {
            if (winner !== null && finalReason !== '') {
              save.mutate({ winner, reason: finalReason });
            }
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span>Победитель</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {([1, 2] as const).map((slot) => (
                  <Chip
                    key={slot}
                    active={winner === slot}
                    onClick={() => setWinner(slot)}
                  >
                    {slotName(m, slot)}
                  </Chip>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span>Причина</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {TECH_REASONS.map((r) => (
                  <Chip
                    key={r}
                    active={reason === r}
                    onClick={() => setReason(r)}
                  >
                    {r}
                  </Chip>
                ))}
                <Chip
                  active={reason === 'other'}
                  onClick={() => setReason('other')}
                >
                  Другое
                </Chip>
              </div>
              {reason === 'other' && (
                <Field
                  autoFocus
                  maxLength={200}
                  placeholder="Причина"
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                />
              )}
            </div>
          </div>
        </ConfirmDialog>
      )}
    </section>
  );
}

// ── Страница ─────────────────────────────────────────────────────────────────

export default function RefereeMatchPage() {
  const { matchId = '' } = useParams();
  const { data: detail, isLoading, error } = useMatchDetail(matchId);
  const now = useNow(10_000);
  useRefereeTitle(
    detail
      ? `${slotName(detail.match, 1)} — ${slotName(detail.match, 2)}`
      : null,
  );

  if (isLoading) return <Loader />;
  if (!detail) {
    return (
      <Page>
        <BackLink to="/referee" label="Пульт" />
        <ErrorBox message={error?.message ?? 'Матч не найден'} />
      </Page>
    );
  }

  const m = detail.match;
  const { tournament } = detail;
  const running = tournament.status === 'in_progress';
  const canAct = running && isActive(m);
  const called = isCalled(m);
  const both = hasBothPlayers(m);
  const reporter = nameById(m, m.reportedBy);
  const disputer = disputerName(m);
  // На странице матча нет всей сетки — «Финал/Полуфинал» не вычислить.
  const stage = matchStageLabel(m, tournament.format, null);

  return (
    <Page>
      <BackLink to={`/referee/t/${tournament.id}`} label={tournament.name} />

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, fontSize: 13, color: 'var(--text-faint)' }}>
            {stage}
            {m.tableName ? ` · ${m.tableName}` : ''}
            {` · до ${detail.winScore}`}
          </span>
          <MatchStatusBadge status={m.status} />
        </div>
        <ScoreRow match={m} slot={1} />
        <ScoreRow match={m} slot={2} />
        {detail.frames.length > 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>
            Фреймы:{' '}
            {detail.frames
              .map((f) => `${f.player1Points}:${f.player2Points}`)
              .join(', ')}
          </div>
        )}
      </Card>

      {m.disputedAt !== null && (
        <Banner tone="danger" title="Результат оспорен">
          {disputer ?? 'Игрок'} оспорил
          {m.disputedScore ? ` счёт ${m.disputedScore}` : ' результат'}.
          Зафиксируйте итоговый счёт или технический результат.
        </Banner>
      )}
      {m.status === 'pending_confirmation' && (
        <Banner tone="warning" title="Ждёт подтверждения соперником">
          {reporter ?? 'Игрок'} внёс счёт {scoreText(m)}. Можно дождаться
          подтверждения или зафиксировать итог самому.
        </Banner>
      )}
      {m.status === 'completed' && (
        <Banner tone="success" title={`Матч завершён: ${scoreText(m)}`}>
          {m.isTechnicalResult
            ? `Технический результат${m.technicalReason ? ` — ${m.technicalReason}` : ''}. `
            : ''}
          Исправить результат может только администратор.
        </Banner>
      )}
      {m.status === 'cancelled' && <Banner tone="info" title="Матч отменён" />}
      {!running && isActive(m) && (
        <Banner tone="info" title="Турнир не идёт">
          Действия судьи станут доступны после старта турнира.
        </Banner>
      )}
      {canAct && !both && (
        <Banner tone="info" title="Ожидается соперник">
          Матч можно будет провести, когда определятся оба игрока.
        </Banner>
      )}

      {canAct && called && <CallSection detail={detail} now={now} />}
      {canAct && m.status === 'scheduled' && !called && (
        <WaitingSection detail={detail} />
      )}
      {canAct && tournament.scheduleMode === 'per_match' && (
        <ScheduleSection detail={detail} />
      )}
      {canAct && both && <ResultSection detail={detail} />}
      {canAct && both && <TechnicalSection detail={detail} />}
      {canAct && !called && <TableSection detail={detail} />}
      {m.scheduledAt && tournament.scheduleMode !== 'per_match' && (
        <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>
          Время: {formatDateTime(m.scheduledAt)}
        </div>
      )}
    </Page>
  );
}
