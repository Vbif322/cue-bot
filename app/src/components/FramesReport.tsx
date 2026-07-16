// Пофреймовый ввод результата (снукер) для игрока: строки со счётом фреймов и
// необязательными макс. брейками, текущий счёт по фреймам и одна отправка через
// двухфазное подтверждение (→ pending_confirmation). Тёмная тема, контролы cb-*.
import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { matchesApi } from '../lib/api.ts';
import type { AppMatch } from '../lib/types.ts';
import { Btn, Field } from './controls.tsx';
import { ErrorBox } from './ui.tsx';

interface FrameRow {
  p1: string;
  p2: string;
  b1: string;
  b2: string;
}

const emptyRow = (): FrameRow => ({ p1: '', p2: '', b1: '', b2: '' });

function parseInt0(v: string): number | null {
  const t = v.trim();
  if (t === '') return null;
  if (!/^\d+$/.test(t)) return NaN;
  return parseInt(t, 10);
}

interface ParsedFrame {
  player1Points: number;
  player2Points: number;
  player1Break?: number | null;
  player2Break?: number | null;
}

function validateRows(
  rows: FrameRow[],
  winScore: number,
): { frames: ParsedFrame[] } | { error: string } {
  const frames: ParsedFrame[] = [];
  let won1 = 0;
  let won2 = 0;
  for (const [i, row] of rows.entries()) {
    const n = i + 1;
    const p1 = parseInt0(row.p1);
    const p2 = parseInt0(row.p2);
    if (p1 === null || p2 === null)
      return { error: `Фрейм ${n}: укажите счёт обоих игроков` };
    if (Number.isNaN(p1) || Number.isNaN(p2))
      return { error: `Фрейм ${n}: счёт должен быть целым числом` };
    if (p1 === p2) return { error: `Фрейм ${n}: ничья недопустима` };

    const b1 = parseInt0(row.b1);
    const b2 = parseInt0(row.b2);
    if (Number.isNaN(b1) || Number.isNaN(b2))
      return { error: `Фрейм ${n}: брейк должен быть целым числом` };
    if (b1 !== null && b1 > p1)
      return { error: `Фрейм ${n}: брейк 1 больше очков игрока` };
    if (b2 !== null && b2 > p2)
      return { error: `Фрейм ${n}: брейк 2 больше очков игрока` };

    frames.push({
      player1Points: p1,
      player2Points: p2,
      player1Break: b1,
      player2Break: b2,
    });
    if (p1 > p2) won1++;
    else won2++;
  }

  const leader = Math.max(won1, won2);
  const loser = Math.min(won1, won2);
  if (leader !== winScore || loser >= winScore)
    return { error: `Один игрок должен выиграть ровно ${winScore} фреймов` };

  return { frames };
}

const scoreInput: React.CSSProperties = { width: 54, textAlign: 'center' };

export default function FramesReport({
  match,
  winScore,
  onDone,
}: {
  match: AppMatch;
  winScore: number;
  onDone: () => void;
}) {
  const [rows, setRows] = useState<FrameRow[]>([emptyRow()]);

  const tally = useMemo(() => {
    let a = 0;
    let b = 0;
    for (const row of rows) {
      const p1 = parseInt0(row.p1);
      const p2 = parseInt0(row.p2);
      if (p1 == null || p2 == null || Number.isNaN(p1) || Number.isNaN(p2))
        continue;
      if (p1 > p2) a++;
      else if (p2 > p1) b++;
    }
    return { a, b };
  }, [rows]);

  const validation = useMemo(
    () => validateRows(rows, winScore),
    [rows, winScore],
  );

  const mutation = useMutation({
    mutationFn: () => {
      if (!('frames' in validation)) throw new Error(validation.error);
      return matchesApi.reportFrames(match.id, validation.frames);
    },
    onSuccess: onDone,
  });

  const setRow = (i: number, patch: Partial<FrameRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
        Внести результат по фреймам
      </div>

      {rows.map((row, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 16, fontSize: 12, color: 'var(--text-faint)' }}>
            {i + 1}
          </span>
          <Field
            type="number"
            min={0}
            inputMode="numeric"
            aria-label={`Фрейм ${i + 1}, счёт 1`}
            value={row.p1}
            onChange={(e) => setRow(i, { p1: e.target.value })}
            style={scoreInput}
          />
          <span style={{ color: 'var(--text-disabled)', fontWeight: 700 }}>:</span>
          <Field
            type="number"
            min={0}
            inputMode="numeric"
            aria-label={`Фрейм ${i + 1}, счёт 2`}
            value={row.p2}
            onChange={(e) => setRow(i, { p2: e.target.value })}
            style={scoreInput}
          />
          <Field
            type="number"
            min={0}
            inputMode="numeric"
            placeholder="бр.1"
            aria-label={`Фрейм ${i + 1}, брейк 1`}
            value={row.b1}
            onChange={(e) => setRow(i, { b1: e.target.value })}
            style={scoreInput}
          />
          <Field
            type="number"
            min={0}
            inputMode="numeric"
            placeholder="бр.2"
            aria-label={`Фрейм ${i + 1}, брейк 2`}
            value={row.b2}
            onChange={(e) => setRow(i, { b2: e.target.value })}
            style={scoreInput}
          />
          <button
            type="button"
            onClick={() =>
              setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs))
            }
            disabled={rows.length === 1}
            aria-label="Удалить фрейм"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-faint)',
              cursor: rows.length === 1 ? 'default' : 'pointer',
              opacity: rows.length === 1 ? 0.3 : 1,
              fontSize: 16,
              padding: 4,
            }}
          >
            ✕
          </button>
        </div>
      ))}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Btn
          variant="ghost"
          size="sm"
          onClick={() => setRows((rs) => [...rs, emptyRow()])}
        >
          ＋ Фрейм
        </Btn>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          Счёт по фреймам: {tally.a} : {tally.b}
        </span>
      </div>

      {mutation.error && <ErrorBox message={mutation.error.message} />}

      <Btn
        block
        disabled={mutation.isPending || 'error' in validation}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? 'Отправка…' : 'Отправить результат'}
      </Btn>
    </div>
  );
}
