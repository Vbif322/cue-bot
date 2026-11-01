// Пофреймовый ввод результата (снукер): строки со счётом фреймов и
// необязательными макс. брейками. «＋ Фрейм» сохраняет фрейм на сервер, так что
// закрытое окно ничего не теряет. Игрок отправляет итог через двухфазное
// подтверждение (→ pending_confirmation); судейский пульт подменяет API
// черновика (`draftApi`) и сам решает, что делать с итогом (`onSubmit`).
// Тёмная тема, контролы cb-*.
import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFrameDraft, type DraftFrame, type FramePayload } from '@cue-bot/ui';
import { matchesApi } from '../lib/api.ts';
import type { AppMatch, AppMatchFrame } from '../lib/types.ts';
import { Btn, Field } from './controls.tsx';
import { ErrorBox } from './ui.tsx';

// Узкие поля: текстовые (без стрелок спиннера) и с малым паддингом, иначе на
// десктопе двузначное число и «бр.1» не помещаются.
const scoreInput: React.CSSProperties = {
  width: 54,
  textAlign: 'center',
  paddingLeft: 4,
  paddingRight: 4,
};

/** Только цифры: поле текстовое, `type=number` не фильтрует ввод за нас. */
const digits = (v: string) => v.replace(/\D/g, '');

const linkButton: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: 4,
};

/** Источник черновика фреймов, если не API игрока (судейский пульт). */
export interface FramesDraftApi {
  load: () => Promise<AppMatchFrame[]>;
  saveFrame: (n: number, frame: FramePayload) => Promise<AppMatchFrame[]>;
  deleteLastFrame: () => Promise<AppMatchFrame[]>;
}

export default function FramesReport({
  match,
  winScore,
  onDone,
  draftApi,
  onSubmit,
  submitting = false,
  title = 'Внести результат по фреймам',
  submitLabel = 'Отправить результат',
}: {
  match: AppMatch;
  winScore: number;
  onDone?: () => void;
  draftApi?: FramesDraftApi;
  /** Итог забирает родитель (например, подтверждение судьи) вместо отправки игроком. */
  onSubmit?: (frames: FramePayload[]) => void;
  submitting?: boolean;
  title?: string;
  submitLabel?: string;
}) {
  const queryClient = useQueryClient();
  // Отдельный ключ кэша у пульта: другой эндпоинт (права судьи, не игрока).
  const isReferee = draftApi !== undefined;
  const framesKey = useMemo(
    () =>
      isReferee
        ? ['referee', 'match-frames', match.id]
        : ['match-frames', match.id],
    [isReferee, match.id],
  );

  const { data: savedFrames, error: loadError } = useQuery({
    queryKey: framesKey,
    queryFn: () => (draftApi ? draftApi.load() : matchesApi.frames(match.id)),
  });

  const onSynced = useCallback(
    (frames: DraftFrame[]) => queryClient.setQueryData(framesKey, frames),
    [queryClient, framesKey],
  );

  const draft = useFrameDraft({
    savedFrames,
    winScore,
    saveFrame: (n, frame) =>
      draftApi
        ? draftApi.saveFrame(n, frame)
        : matchesApi.saveFrame(match.id, n, frame),
    deleteLastFrame: () =>
      draftApi
        ? draftApi.deleteLastFrame()
        : matchesApi.deleteLastFrame(match.id),
    onSynced,
  });
  const { rows, validation } = draft;

  const mutation = useMutation({
    mutationFn: () => {
      if (!('frames' in validation)) throw new Error(validation.error);
      return matchesApi.reportFrames(match.id, validation.frames);
    },
    onSuccess: () => onDone?.(),
  });
  const submit = () => {
    if (!onSubmit) {
      mutation.mutate();
      return;
    }
    if ('frames' in validation) onSubmit(validation.frames);
  };
  const pending = mutation.isPending || submitting;
  const heading = (
    <div
      style={{
        fontSize: 13,
        fontWeight: 600,
        color: 'var(--text-secondary)',
      }}
    >
      {title}
    </div>
  );

  // До загрузки черновика пустая форма выглядит рабочей, а введённое поверх
  // затрётся сохранёнными фреймами — поэтому не показываем её вовсе.
  if (draft.loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {heading}
        {loadError ? (
          <ErrorBox message={loadError.message} />
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>
            Загрузка фреймов…
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {heading}

      {rows.map((row, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            title={row.saved ? 'Сохранён' : 'Не сохранён'}
            style={{
              width: 22,
              fontSize: 12,
              color: row.saved
                ? 'var(--color-tone-success-fg)'
                : 'var(--text-faint)',
            }}
          >
            {i + 1}
            {row.saved && '✓'}
          </span>
          <Field
            type="text"
            inputMode="numeric"
            autoComplete="off"
            aria-label={`Фрейм ${i + 1}, счёт 1`}
            value={row.p1}
            onChange={(e) => draft.setCell(i, { p1: digits(e.target.value) })}
            style={scoreInput}
          />
          <span style={{ color: 'var(--text-disabled)', fontWeight: 700 }}>
            :
          </span>
          <Field
            type="text"
            inputMode="numeric"
            autoComplete="off"
            aria-label={`Фрейм ${i + 1}, счёт 2`}
            value={row.p2}
            onChange={(e) => draft.setCell(i, { p2: digits(e.target.value) })}
            style={scoreInput}
          />
          <Field
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="бр.1"
            aria-label={`Фрейм ${i + 1}, брейк 1`}
            value={row.b1}
            onChange={(e) => draft.setCell(i, { b1: digits(e.target.value) })}
            style={scoreInput}
          />
          <Field
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="бр.2"
            aria-label={`Фрейм ${i + 1}, брейк 2`}
            value={row.b2}
            onChange={(e) => draft.setCell(i, { b2: digits(e.target.value) })}
            style={scoreInput}
          />
          {draft.canSaveRow(i) && (
            <button
              type="button"
              onClick={() => draft.saveRow(i)}
              aria-label={`Сохранить фрейм ${i + 1}`}
              style={{
                ...linkButton,
                color: 'var(--color-primary)',
                fontSize: 12,
              }}
            >
              Сохр.
            </button>
          )}
          {i === draft.deletableIndex && (
            <button
              type="button"
              onClick={() => draft.deleteRow(i)}
              disabled={draft.busy}
              aria-label="Удалить фрейм"
              style={{
                ...linkButton,
                color: 'var(--text-faint)',
                opacity: draft.busy ? 0.3 : 1,
                fontSize: 16,
              }}
            >
              ✕
            </button>
          )}
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
          disabled={!draft.canAdd}
          onClick={draft.addFrame}
          title="Сохранить фрейм и добавить следующий"
        >
          {draft.busy ? 'Сохранение…' : '＋ Фрейм'}
        </Btn>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          Счёт по фреймам: {draft.tally.a} : {draft.tally.b}
        </span>
      </div>

      {draft.error && <ErrorBox message={draft.error} />}
      {mutation.error && <ErrorBox message={mutation.error.message} />}

      <Btn
        block
        disabled={pending || draft.busy || 'error' in validation}
        onClick={submit}
      >
        {pending ? 'Отправка…' : submitLabel}
      </Btn>
    </div>
  );
}
