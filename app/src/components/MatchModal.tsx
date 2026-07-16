// Карточка матча (макет match-detail), упрощённая под API игрока: отчёт — два
// целых числа (счёт1:счёт2), плюс подтверждение и спор. Тёмная оболочка AppModal;
// статус — через @cue-bot/ui MatchStatusBadge.
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MatchStatusBadge } from '@cue-bot/ui';
import { matchesApi, tournamentsApi } from '../lib/api.ts';
import type { AppMatch } from '../lib/types.ts';
import { useMe } from '../lib/useAuth.ts';
import { displayName, initials, gradientFor } from '../lib/format.ts';
import AppModal from './AppModal.tsx';
import { Btn, Field } from './controls.tsx';
import { Avatar, ErrorBox } from './ui.tsx';
import FramesReport from './FramesReport.tsx';

interface Side {
  id: string | null;
  name: string;
  score: number | null;
  you: boolean;
  lead: boolean;
  grad: string;
  init: string;
}

function playerName(m: AppMatch, slot: 1 | 2): string {
  if (slot === 1) {
    if (m.player1IsWalkover) return 'Проходит';
    if (!m.player1Id) return 'Ожидается';
    return displayName({ name: m.player1Name, surname: m.player1Surname, username: m.player1Username });
  }
  if (m.player2IsWalkover) return 'Проходит';
  if (!m.player2Id) return 'Ожидается';
  return displayName({ name: m.player2Name, surname: m.player2Surname, username: m.player2Username });
}

function ScoreRow({ side }: { side: Side }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <Avatar
        label={side.id ? side.init : '—'}
        gradientKey={side.grad}
        you={side.you}
        size={38}
      />
      <span
        style={{
          flex: 1,
          fontSize: 16,
          fontWeight: side.you || side.lead ? 700 : 500,
          color: side.you ? 'var(--accent-fg)' : side.lead ? 'var(--text-primary)' : 'var(--text-muted)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {side.name}
      </span>
      <span
        style={{
          fontSize: 26,
          fontWeight: 700,
          color: side.lead ? 'var(--text-primary)' : 'var(--text-faint)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {side.score ?? '—'}
      </span>
    </div>
  );
}

export default function MatchModal({
  matchId,
  onClose,
}: {
  matchId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const myId = me?.user?.id ?? null;

  const { data: match, isLoading } = useQuery({
    queryKey: ['match', matchId],
    queryFn: () => matchesApi.get(matchId),
  });

  const { data: tournamentDetail } = useQuery({
    queryKey: ['tournament', match?.tournamentId],
    queryFn: () => tournamentsApi.get(match!.tournamentId),
    enabled: !!match?.tournamentId,
  });
  const tournament = tournamentDetail?.tournament;
  // Snooker disciplines are all id-prefixed `snooker_*`; the app models
  // `discipline` loosely, so match on the prefix rather than importing the
  // backend helper (which would drag server-only modules into the app build).
  const isSnooker =
    !!tournament && String(tournament.discipline).startsWith('snooker');

  const hasScore0 = match?.player1Score != null && match?.player2Score != null;
  const { data: frames } = useQuery({
    queryKey: ['match-frames', matchId],
    queryFn: () => matchesApi.frames(matchId),
    enabled: !!matchId && isSnooker && hasScore0,
  });

  const [scores, setScores] = useState({ p1: '', p2: '' });
  const [showDispute, setShowDispute] = useState(false);

  useEffect(() => {
    if (match) {
      setScores({
        p1: match.player1Score?.toString() ?? '',
        p2: match.player2Score?.toString() ?? '',
      });
    }
  }, [match?.id, match?.player1Score, match?.player2Score]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['match', matchId] });
    qc.invalidateQueries({ queryKey: ['me', 'matches'] });
    if (match) {
      qc.invalidateQueries({ queryKey: ['tournament', match.tournamentId] });
      qc.invalidateQueries({ queryKey: ['bracket', match.tournamentId] });
    }
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };

  const reportMut = useMutation({
    mutationFn: () =>
      matchesApi.report(matchId, Number(scores.p1 || 0), Number(scores.p2 || 0)),
    onSuccess: invalidate,
  });
  const confirmMut = useMutation({
    mutationFn: () => matchesApi.confirm(matchId),
    onSuccess: invalidate,
  });
  const disputeMut = useMutation({
    mutationFn: () => matchesApi.dispute(matchId),
    onSuccess: () => {
      invalidate();
      setShowDispute(false);
    },
  });

  if (isLoading || !match) {
    return (
      <AppModal onClose={onClose} title="Матч">
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-faint)' }}>Загрузка…</div>
      </AppModal>
    );
  }

  const isPlayer = myId != null && (match.player1Id === myId || match.player2Id === myId);
  const s1 = match.player1Score;
  const s2 = match.player2Score;
  const hasScore = s1 != null && s2 != null;

  const side1: Side = {
    id: match.player1Id,
    name: playerName(match, 1),
    score: s1,
    you: myId != null && match.player1Id === myId,
    lead: hasScore && s1! > s2!,
    grad: gradientFor(match.player1Id ?? '1'),
    init: initials({ name: match.player1Name, surname: match.player1Surname, username: match.player1Username }),
  };
  const side2: Side = {
    id: match.player2Id,
    name: playerName(match, 2),
    score: s2,
    you: myId != null && match.player2Id === myId,
    lead: hasScore && s2! > s1!,
    grad: gradientFor(match.player2Id ?? '2'),
    init: initials({ name: match.player2Name, surname: match.player2Surname, username: match.player2Username }),
  };

  const canReport =
    isPlayer && (match.status === 'scheduled' || match.status === 'in_progress');
  const isPending = match.status === 'pending_confirmation';
  const iReported = match.reportedBy != null && match.reportedBy === myId;
  const canConfirm = isPlayer && isPending && !iReported;
  const waitingOpponent = isPlayer && isPending && iReported;
  const isCompleted = match.status === 'completed';
  const isCancelled = match.status === 'cancelled';

  const busy = reportMut.isPending || confirmMut.isPending || disputeMut.isPending;
  const actionError =
    reportMut.error?.message || confirmMut.error?.message || disputeMut.error?.message;

  return (
    <>
      <AppModal
        onClose={onClose}
        title="Матч"
        subtitle={match.tableName ? `Стол: ${match.tableName}` : `Раунд ${match.round}`}
        rightSlot={<MatchStatusBadge status={match.status} />}
      >
        {/* Scoreboard */}
        <div
          style={{
            padding: 18,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <ScoreRow side={side1} />
          <ScoreRow side={side2} />
        </div>

        {/* Body */}
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {actionError && <ErrorBox message={actionError} />}

          {canReport && isSnooker && tournament && (
            <FramesReport
              match={match}
              winScore={tournament.winScore}
              onDone={invalidate}
            />
          )}

          {canReport && !isSnooker && (
            <>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
                Внести результат
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Field
                  type="number"
                  min={0}
                  inputMode="numeric"
                  aria-label={side1.name}
                  value={scores.p1}
                  onChange={(e) => setScores((s) => ({ ...s, p1: e.target.value }))}
                  style={{ textAlign: 'center' }}
                />
                <span style={{ color: 'var(--text-disabled)', fontWeight: 700 }}>:</span>
                <Field
                  type="number"
                  min={0}
                  inputMode="numeric"
                  aria-label={side2.name}
                  value={scores.p2}
                  onChange={(e) => setScores((s) => ({ ...s, p2: e.target.value }))}
                  style={{ textAlign: 'center' }}
                />
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                {side1.name} — счёт слева, {side2.name} — справа.
              </div>
              <Btn
                block
                disabled={busy || scores.p1 === '' || scores.p2 === ''}
                onClick={() => reportMut.mutate()}
              >
                {reportMut.isPending ? 'Отправка…' : 'Отправить результат'}
              </Btn>
            </>
          )}

          {frames && frames.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
                По фреймам
              </div>
              {frames.map((f) => {
                const b: string[] = [];
                if (f.player1Break != null) b.push(`бр.1 ${f.player1Break}`);
                if (f.player2Break != null) b.push(`бр.2 ${f.player2Break}`);
                return (
                  <div
                    key={f.frameNumber}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      fontSize: 13,
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <span style={{ width: 16, color: 'var(--text-faint)' }}>
                      {f.frameNumber}
                    </span>
                    <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                      {f.player1Points} : {f.player2Points}
                    </span>
                    {b.length > 0 && (
                      <span style={{ color: 'var(--text-faint)' }}>🎯 {b.join(', ')}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {waitingOpponent && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                background: 'var(--color-tone-warning-bg)',
                border: '1px solid var(--color-tone-warning-fg)',
                borderRadius: 14,
                padding: 16,
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-tone-warning-fg)' }}>
                Ожидает подтверждения соперником
              </span>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Вы внесли результат {s1}:{s2}. Соперник подтвердит его или оспорит.
              </span>
            </div>
          )}

          {canConfirm && (
            <>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  background: 'var(--color-tone-warning-bg)',
                  border: '1px solid var(--color-tone-warning-fg)',
                  borderRadius: 14,
                  padding: 16,
                }}
              >
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-tone-warning-fg)' }}>
                  Ожидает вашего подтверждения
                </span>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  Соперник внёс результат{' '}
                  <b style={{ color: 'var(--text-secondary)' }}>
                    {s1}:{s2}
                  </b>
                  . Подтвердите его или оспорьте, если не согласны.
                </span>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <Btn block disabled={busy} onClick={() => confirmMut.mutate()}>
                  {confirmMut.isPending ? 'Подтверждение…' : 'Подтвердить'}
                </Btn>
                <Btn variant="danger" disabled={busy} onClick={() => setShowDispute(true)}>
                  Оспорить
                </Btn>
              </div>
            </>
          )}

          {isCompleted && (
            <>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  background: 'var(--color-tone-success-bg)',
                  border: '1px solid var(--color-tone-success-fg)',
                  borderRadius: 14,
                  padding: '14px 16px',
                }}
              >
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-tone-success-fg)' }}>
                  Результат подтверждён
                </span>
                {match.isTechnicalResult && (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                    техническое
                  </span>
                )}
              </div>
              {isPlayer && (
                <Btn variant="danger" block disabled={busy} onClick={() => setShowDispute(true)}>
                  Оспорить результат
                </Btn>
              )}
            </>
          )}

          {isCancelled && (
            <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>Матч отменён.</div>
          )}

          {!isPlayer && !isCompleted && !isCancelled && (
            <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>
              {hasScore ? 'Матч идёт.' : 'Матч ещё не начался.'}
            </div>
          )}
        </div>
      </AppModal>

      {showDispute && (
        <AppModal onClose={() => setShowDispute(false)} maxWidth={400}>
          <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 17, fontWeight: 700 }}>Оспорить результат?</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>
                Соперник и организатор получат уведомление, а результат будет заморожен до
                решения организатора.
              </div>
            </div>
            {disputeMut.error && <ErrorBox message={disputeMut.error.message} />}
            <div style={{ display: 'flex', gap: 10 }}>
              <Btn variant="ghost" block disabled={disputeMut.isPending} onClick={() => setShowDispute(false)}>
                Отмена
              </Btn>
              <Btn
                variant="solid-danger"
                block
                disabled={disputeMut.isPending}
                onClick={() => disputeMut.mutate()}
              >
                {disputeMut.isPending ? 'Отправка…' : 'Оспорить'}
              </Btn>
            </div>
          </div>
        </AppModal>
      )}
    </>
  );
}
