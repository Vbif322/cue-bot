import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFrameDraft, type DraftFrame } from '@cue-bot/ui';
import { matchesApi } from '../../lib/api.ts';
import type { ApiMatch } from '../../lib/api.ts';

/**
 * Snooker per-frame result entry for an in-progress match (admin acts as one of
 * the players). Mirrors the bot's frame-by-frame flow: each frame is saved to
 * the server as it's added («＋ Фрейм»), so closing the page loses nothing; the
 * final submit goes through the two-phase confirmation (→ pending_confirmation).
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
  const queryClient = useQueryClient();
  const [reporterId, setReporterId] = useState(match.player1Id ?? '');

  const { data: savedFrames } = useQuery({
    queryKey: ['match-frames', match.id],
    queryFn: () => matchesApi.frames(match.id),
  });

  const onSynced = useCallback(
    (frames: DraftFrame[]) =>
      queryClient.setQueryData(['match-frames', match.id], frames),
    [queryClient, match.id],
  );

  const draft = useFrameDraft({
    savedFrames,
    winScore,
    saveFrame: (n, frame) => matchesApi.saveFrame(match.id, n, frame),
    deleteLastFrame: () => matchesApi.deleteLastFrame(match.id),
    onSynced,
  });
  const { rows, validation, setError } = draft;

  const player1 = match.player1Name ?? match.player1Username ?? 'Игрок 1';
  const player2 = match.player2Name ?? match.player2Username ?? 'Игрок 2';

  const canSubmit = 'frames' in validation && !!reporterId && !draft.busy;

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
            {match.player1Id && (
              <option value={match.player1Id}>{player1}</option>
            )}
            {match.player2Id && (
              <option value={match.player2Id}>{player2}</option>
            )}
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
            <span
              className={`text-xs w-6 ${row.saved ? 'text-green-600' : 'text-gray-400'}`}
              title={row.saved ? 'Сохранён' : 'Не сохранён'}
            >
              {i + 1}
              {row.saved && '✓'}
            </span>
            <div className="flex items-center justify-center gap-1">
              <input
                type="number"
                min={0}
                value={row.p1}
                onChange={(e) => draft.setCell(i, { p1: e.target.value })}
                className={num}
              />
              <span className="text-gray-400">:</span>
              <input
                type="number"
                min={0}
                value={row.p2}
                onChange={(e) => draft.setCell(i, { p2: e.target.value })}
                className={num}
              />
            </div>
            <input
              type="number"
              min={0}
              placeholder="—"
              value={row.b1}
              onChange={(e) => draft.setCell(i, { b1: e.target.value })}
              className={num}
            />
            <input
              type="number"
              min={0}
              placeholder="—"
              value={row.b2}
              onChange={(e) => draft.setCell(i, { b2: e.target.value })}
              className={num}
            />
            <div className="flex items-center gap-1 min-w-[1.5rem]">
              {draft.canSaveRow(i) && (
                <button
                  type="button"
                  onClick={() => draft.saveRow(i)}
                  className="text-xs text-blue-600 hover:text-blue-700"
                >
                  Сохранить
                </button>
              )}
              {i === draft.deletableIndex && (
                <button
                  type="button"
                  onClick={() => draft.deleteRow(i)}
                  disabled={draft.busy}
                  className="text-gray-400 hover:text-red-600 disabled:opacity-30 px-1"
                  title="Удалить фрейм"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        ))}

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={draft.addFrame}
            disabled={!draft.canAdd}
            className="text-sm text-blue-600 hover:text-blue-700 disabled:opacity-40"
            title="Сохранить фрейм и добавить следующий"
          >
            {draft.busy ? 'Сохранение…' : '＋ Фрейм'}
          </button>
          <span className="text-sm text-gray-600">
            Счёт по фреймам: {draft.tally.a} : {draft.tally.b}
          </span>
        </div>

        {draft.error && (
          <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-200">
            {draft.error}
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
