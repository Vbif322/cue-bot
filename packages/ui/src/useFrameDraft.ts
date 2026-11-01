import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Пофреймовый ввод результата (снукер), общий для админки и сайта игрока.
 * Фреймы сохраняются на сервер по одному (черновик матча в игре), форма
 * подгружает их при открытии и пересинхронизируется после каждого сохранения,
 * подхватывая фреймы, сохранённые другим участником. Итог отправляется
 * отдельно (report-frames → двухфазное подтверждение).
 */

/** Фрейм в формате API. */
export interface DraftFrame {
  frameNumber: number;
  player1Points: number;
  player2Points: number;
  player1Break: number | null;
  player2Break: number | null;
}

/** Фрейм для отправки на сервер. */
export interface FramePayload {
  player1Points: number;
  player2Points: number;
  player1Break: number | null;
  player2Break: number | null;
}

/** Редактируемая строка (строки, чтобы поле могло быть пустым при вводе). */
export interface FrameRow {
  p1: string;
  p2: string;
  b1: string;
  b2: string;
  /** Совпадает с сохранённым на сервере фреймом. */
  saved: boolean;
}

const emptyRow = (): FrameRow => ({
  p1: '',
  p2: '',
  b1: '',
  b2: '',
  saved: false,
});

const fromFrame = (f: DraftFrame): FrameRow => ({
  p1: String(f.player1Points),
  p2: String(f.player2Points),
  b1: f.player1Break == null ? '' : String(f.player1Break),
  b2: f.player2Break == null ? '' : String(f.player2Break),
  saved: true,
});

const isBlank = (row: FrameRow): boolean =>
  [row.p1, row.p2, row.b1, row.b2].every((v) => v.trim() === '');

/** Число из поля: null для пустого, NaN для некорректного. */
function parseInt0(v: string): number | null {
  const t = v.trim();
  if (t === '') return null;
  if (!/^\d+$/.test(t)) return NaN;
  return parseInt(t, 10);
}

/** Разбор одной строки: фрейм или сообщение об ошибке. */
function parseRow(
  row: FrameRow,
  n: number,
): { frame: FramePayload } | { error: string } {
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

  return {
    frame: {
      player1Points: p1,
      player2Points: p2,
      player1Break: b1,
      player2Break: b2,
    },
  };
}

/** Счёт по фреймам по корректно заполненным строкам. */
function tallyRows(rows: FrameRow[]): { a: number; b: number } {
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
}

/** Строки без хвостовой пустой (несохранённой) строки. */
function withoutTrailingBlank(rows: FrameRow[]): FrameRow[] {
  const last = rows[rows.length - 1];
  return last && !last.saved && isBlank(last) ? rows.slice(0, -1) : rows;
}

/** Итоговая проверка перед отправкой: фреймы или сообщение об ошибке. */
function validateRows(
  rows: FrameRow[],
  winScore: number,
): { frames: FramePayload[] } | { error: string } {
  const frames: FramePayload[] = [];
  for (const [i, row] of withoutTrailingBlank(rows).entries()) {
    const parsed = parseRow(row, i + 1);
    if ('error' in parsed) return parsed;
    frames.push(parsed.frame);
  }
  if (frames.length === 0) return { error: 'Нужно ввести хотя бы один фрейм' };

  const { a, b } = tallyRows(rows);
  if (Math.max(a, b) !== winScore || Math.min(a, b) >= winScore)
    return { error: `Один игрок должен выиграть ровно ${winScore} фреймов` };
  return { frames };
}

/** Добавляет пустую строку для следующего фрейма, если матч ещё не решён. */
function withTrailingRow(rows: FrameRow[], winScore: number): FrameRow[] {
  const { a, b } = tallyRows(rows);
  if (a >= winScore || b >= winScore) return rows;
  const last = rows[rows.length - 1];
  return !last || last.saved ? [...rows, emptyRow()] : rows;
}

/**
 * Накладывает ответ сервера на локальные строки: сохранённые фреймы берутся с
 * сервера, а несохранённые правки в других строках (кроме `syncedIndex`,
 * которую только что сохранили/удалили) остаются как есть.
 */
function mergeServer(
  frames: DraftFrame[],
  local: FrameRow[],
  syncedIndex: number,
): FrameRow[] {
  const out = frames.map((f, i) => {
    const row = local[i];
    return row && !row.saved && i !== syncedIndex ? row : fromFrame(f);
  });
  for (let i = frames.length; i < local.length; i++) {
    const row = local[i];
    if (row && i !== syncedIndex) out.push({ ...row, saved: false });
  }
  return out;
}

export function useFrameDraft({
  savedFrames,
  winScore,
  saveFrame,
  deleteLastFrame,
  onSynced,
}: {
  /** Сохранённые фреймы с сервера (undefined, пока грузятся). */
  savedFrames: DraftFrame[] | undefined;
  winScore: number;
  saveFrame: (
    frameNumber: number,
    frame: FramePayload,
  ) => Promise<DraftFrame[]>;
  deleteLastFrame: () => Promise<DraftFrame[]>;
  /** Вызывается с актуальным списком после каждого сохранения/удаления. */
  onSynced?: (frames: DraftFrame[]) => void;
}) {
  const [rows, setRows] = useState<FrameRow[]>([emptyRow()]);
  const [serverCount, setServerCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current || !savedFrames) return;
    initialized.current = true;
    setRows(withTrailingRow(savedFrames.map(fromFrame), winScore));
    setServerCount(savedFrames.length);
    setLoaded(true);
  }, [savedFrames, winScore]);

  const tally = useMemo(() => tallyRows(rows), [rows]);
  const validation = useMemo(
    () => validateRows(rows, winScore),
    [rows, winScore],
  );
  const decided = tally.a >= winScore || tally.b >= winScore;

  const setCell = (i: number, patch: Partial<Omit<FrameRow, 'saved'>>) =>
    setRows((rs) =>
      rs.map((r, j) => (j === i ? { ...r, ...patch, saved: false } : r)),
    );

  const sync = useCallback(
    (frames: DraftFrame[], syncedIndex: number) => {
      setRows((local) =>
        withTrailingRow(mergeServer(frames, local, syncedIndex), winScore),
      );
      setServerCount(frames.length);
      onSynced?.(frames);
    },
    [winScore, onSynced],
  );

  const run = async (op: () => Promise<DraftFrame[]>, syncedIndex: number) => {
    setBusy(true);
    try {
      sync(await op(), syncedIndex);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** Сохранить строку `i` как фрейм `i + 1`. */
  const saveRow = (i: number) => {
    const row = rows[i];
    if (!row) return;
    const parsed = parseRow(row, i + 1);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    void run(() => saveFrame(i + 1, parsed.frame), i);
  };

  const lastIndex = rows.length - 1;
  const lastRow = rows[lastIndex];
  /** «＋ Фрейм»: сохранить последнюю строку и открыть следующую. */
  const canAdd =
    !busy && !!lastRow && !lastRow.saved && !isBlank(lastRow) && !decided;
  const addFrame = () => saveRow(lastIndex);

  /** Сохранённый ранее фрейм, который отредактировали, — показать «Сохранить». */
  const canSaveRow = (i: number) =>
    !busy && i < serverCount && rows[i]?.saved === false;

  /** Удалять можно только последний фрейм (хвостовая пустая строка не в счёт). */
  const deletableIndex = (() => {
    const i =
      lastRow && !lastRow.saved && isBlank(lastRow) ? lastIndex - 1 : lastIndex;
    const row = rows[i];
    return row && (row.saved || !isBlank(row)) ? i : -1;
  })();

  const deleteRow = (i: number) => {
    if (i !== deletableIndex) return;
    if (i < serverCount) {
      void run(deleteLastFrame, i);
    } else {
      setRows((rs) =>
        withTrailingRow(
          rs.filter((_, j) => j !== i),
          winScore,
        ),
      );
    }
  };

  return {
    /** Черновик ещё не загружен: пустые строки — не настоящие, ввод поверх потеряется. */
    loading: !loaded,
    rows,
    setCell,
    tally,
    /** Итоговые фреймы для report-frames или причина, почему отправить нельзя. */
    validation,
    busy,
    error,
    setError,
    canAdd,
    addFrame,
    canSaveRow,
    saveRow,
    deletableIndex,
    deleteRow,
  };
}
