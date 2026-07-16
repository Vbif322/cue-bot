import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { matchesApi } from '../../lib/api.ts';
import type { ApiMatch } from '../../lib/api.ts';

/** One editable frame row (strings so inputs can be blank while typing). */
interface FrameRow {
  p1: string;
  p2: string;
  b1: string;
  b2: string;
}

const emptyRow = (): FrameRow => ({ p1: '', p2: '', b1: '', b2: '' });

/** Parse a numeric input; returns null for blank, NaN for invalid. */
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

/** Validate all rows; returns the frames payload or a Russian error message. */
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

/**
 * Snooker per-frame result entry for an in-progress match (admin acts as one of
 * the players). Mirrors the bot's frame-by-frame flow: rows of frame scores with
 * optional max breaks, a running frames-won tally, and a single submit that goes
 * through the two-phase confirmation (→ pending_confirmation).
 */
export default function ReportFramesCard({
  match,
  winScore,
  onSuccess,
}: {
  match: ApiMatch;
  winScore: number;
  onSuccess: () => void;
}) {
  const [reporterId, setReporterId] = useState(match.player1Id ?? '');
  const [rows, setRows] = useState<FrameRow[]>([emptyRow()]);
  const [error, setError] = useState('');

  const player1 = match.player1Name ?? match.player1Username ?? 'Игрок 1';
  const player2 = match.player2Name ?? match.player2Username ?? 'Игрок 2';

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

  const validation = useMemo(() => validateRows(rows, winScore), [rows, winScore]);
  const canSubmit = 'frames' in validation && !!reporterId;

  const mutation = useMutation({
    mutationFn: () => {
      if (!('frames' in validation)) throw new Error(validation.error);
      return matchesApi.reportFrames(match.id, {
        reporterId,
        frames: validation.frames,
      });
    },
    onSuccess: () => {
      setError('');
      onSuccess();
    },
    onError: (e: Error) => setError(e.message),
  });

  const setRow = (i: number, patch: Partial<FrameRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const num =
    'w-16 px-2 py-1 border border-gray-300 rounded text-center text-sm';

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">
        Внести результат по фреймам
      </h3>
      <div className="space-y-3">
        <div>
          <p className="text-xs text-gray-500 mb-1">От лица</p>
          <select
            value={reporterId}
            onChange={(e) => setReporterId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            {match.player1Id && <option value={match.player1Id}>{player1}</option>}
            {match.player2Id && <option value={match.player2Id}>{player2}</option>}
          </select>
        </div>

        <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-2 items-center text-xs text-gray-500">
          <span />
          <span className="text-center">
            Счёт ({player1} : {player2})
          </span>
          <span className="text-center">Брейк 1</span>
          <span className="text-center">Брейк 2</span>
          <span />
        </div>

        {rows.map((row, i) => (
          <div
            key={i}
            className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-2 items-center"
          >
            <span className="text-xs text-gray-400 w-4">{i + 1}</span>
            <div className="flex items-center justify-center gap-1">
              <input
                type="number"
                min={0}
                value={row.p1}
                onChange={(e) => setRow(i, { p1: e.target.value })}
                className={num}
              />
              <span className="text-gray-400">:</span>
              <input
                type="number"
                min={0}
                value={row.p2}
                onChange={(e) => setRow(i, { p2: e.target.value })}
                className={num}
              />
            </div>
            <input
              type="number"
              min={0}
              placeholder="—"
              value={row.b1}
              onChange={(e) => setRow(i, { b1: e.target.value })}
              className={num}
            />
            <input
              type="number"
              min={0}
              placeholder="—"
              value={row.b2}
              onChange={(e) => setRow(i, { b2: e.target.value })}
              className={num}
            />
            <button
              type="button"
              onClick={() =>
                setRows((rs) =>
                  rs.length > 1 ? rs.filter((_, j) => j !== i) : rs,
                )
              }
              disabled={rows.length === 1}
              className="text-gray-400 hover:text-red-600 disabled:opacity-30 px-1"
              title="Удалить фрейм"
            >
              ✕
            </button>
          </div>
        ))}

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setRows((rs) => [...rs, emptyRow()])}
            className="text-sm text-blue-600 hover:text-blue-700"
          >
            ＋ Добавить фрейм
          </button>
          <span className="text-sm text-gray-600">
            Счёт по фреймам: {tally.a} : {tally.b}
          </span>
        </div>

        {error && (
          <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-200">
            {error}
          </div>
        )}

        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !canSubmit}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {mutation.isPending ? 'Отправка…' : 'Подать'}
        </button>
      </div>
    </div>
  );
}
