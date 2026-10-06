import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { InfoRow } from '@cue-bot/ui';
import {
  MAX_PRIZE_PLACES,
  PRIZE_MODE_LABELS,
  PRIZE_PRESETS,
  computePrizeDistribution,
  expectedParticipants,
  formatPlaceRange,
  formatRubles,
  prizeFundFor,
  prizeModes,
  validateFinanceSettings,
} from '@server/apiTypes';
import { tournamentsApi } from '../../lib/api.ts';
import type {
  ApiPrizeRow,
  ApiTournament,
  IFinanceSettings,
  IPrizeMode,
} from '../../lib/api.ts';

const inputClass =
  'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50';

const DEFAULT_PERCENTS = PRIZE_PRESETS[2]?.percents ?? [100];

function playerName(row: ApiPrizeRow): string {
  return row.name ?? (row.username ? `@${row.username}` : '—');
}

/**
 * Form state: raw input strings, so a field can be empty while typing. The
 * prize mode sets the unit of both the organizer's cut and the prizes; each
 * mode keeps its own values, so switching back and forth loses nothing.
 */
interface Draft {
  entryFee: string;
  prizeMode: IPrizeMode;
  organizerFee: Record<IPrizeMode, string>;
  values: Record<IPrizeMode, string[]>;
}

function toDraft(t: ApiTournament, participantsCount: number): Draft {
  const saved = (t.prizeDistribution ?? []).map((p) => String(p.value));
  const percents =
    t.prizeMode === 'percent' && saved.length > 0
      ? saved
      : DEFAULT_PERCENTS.map(String);

  // A mode never saved starts from what the percent settings would give at
  // the expected turnout, so switching to rubles shows familiar numbers.
  const collected = (t.entryFee ?? 0) * participantsCount;
  const cutAmount =
    t.prizeMode === 'fixed'
      ? t.organizerFeeAmount
      : Math.floor((collected * t.organizerFeePercent) / 100);
  const fund = collected - cutAmount;
  const amounts =
    t.prizeMode === 'fixed' && saved.length > 0
      ? saved
      : percents.map((p) =>
          fund > 0 ? String(Math.floor((fund * Number(p)) / 100)) : '',
        );

  return {
    entryFee: t.entryFee === null ? '' : String(t.entryFee),
    prizeMode: t.prizeMode,
    organizerFee: {
      percent: String(t.organizerFeePercent),
      fixed: String(cutAmount),
    },
    values: { percent: percents, fixed: amounts },
  };
}

/**
 * Only the active mode's values come from the form; the other mode's
 * organizer value stays as saved, so an untouched form is not dirty.
 */
function toSettings(d: Draft, t: ApiTournament): IFinanceSettings {
  if (d.entryFee.trim() === '') {
    return {
      entryFee: null,
      organizerFeePercent: 0,
      organizerFeeAmount: 0,
      prizeMode: 'percent',
      prizeDistribution: null,
    };
  }
  const cut = Number(d.organizerFee[d.prizeMode] || 0);
  return {
    entryFee: Number(d.entryFee),
    organizerFeePercent:
      d.prizeMode === 'percent' ? cut : t.organizerFeePercent,
    organizerFeeAmount: d.prizeMode === 'fixed' ? cut : t.organizerFeeAmount,
    prizeMode: d.prizeMode,
    prizeDistribution: d.values[d.prizeMode].map((v, i) => ({
      place: i + 1,
      value: Number(v),
    })),
  };
}

function FinanceForm({ tournament }: { tournament: ApiTournament }) {
  const qc = useQueryClient();
  const participantsCount = expectedParticipants(tournament);
  const [draft, setDraft] = useState<Draft>(() =>
    toDraft(tournament, participantsCount),
  );
  const readOnly = tournament.status === 'cancelled';
  const isPercent = draft.prizeMode === 'percent';
  const values = draft.values[draft.prizeMode];

  const settings = toSettings(draft, tournament);
  const error = validateFinanceSettings(settings, participantsCount);
  const saved: IFinanceSettings = {
    entryFee: tournament.entryFee,
    organizerFeePercent: tournament.organizerFeePercent,
    organizerFeeAmount: tournament.organizerFeeAmount,
    prizeMode: tournament.prizeMode,
    prizeDistribution: tournament.prizeDistribution,
  };
  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);

  const save = useMutation({
    mutationFn: () => tournamentsApi.setFinance(tournament.id, settings),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tournament', tournament.id] });
      qc.invalidateQueries({ queryKey: ['tournament-prizes', tournament.id] });
    },
  });

  const setValues = (next: string[]) =>
    setDraft({
      ...draft,
      values: { ...draft.values, [draft.prizeMode]: next },
    });

  const total = values.reduce((s, v) => s + Number(v || 0), 0);
  const fund =
    settings.entryFee === null
      ? null
      : prizeFundFor(
          { ...settings, entryFee: settings.entryFee },
          participantsCount,
        );
  const totalOk = isPercent ? total === 100 : fund !== null && total <= fund;

  // Live preview of the unsaved settings, for the expected turnout.
  const preview =
    error === null && settings.entryFee !== null && settings.prizeDistribution
      ? computePrizeDistribution({
          ...settings,
          entryFee: settings.entryFee,
          prizeDistribution: settings.prizeDistribution,
          participantsCount,
        }).summary
      : null;

  return (
    <form
      className="bg-white rounded-xl border border-gray-200 p-5 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Взнос, ₽
          </label>
          <input
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            placeholder="Бесплатный турнир"
            value={draft.entryFee}
            disabled={readOnly}
            onChange={(e) => setDraft({ ...draft, entryFee: e.target.value })}
            className={inputClass}
          />
        </div>
        {draft.entryFee.trim() !== '' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Доля организатора, {isPercent ? '%' : '₽'}
            </label>
            <input
              type="number"
              min={0}
              max={isPercent ? 100 : undefined}
              step={1}
              inputMode="numeric"
              value={draft.organizerFee[draft.prizeMode]}
              disabled={readOnly}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  organizerFee: {
                    ...draft.organizerFee,
                    [draft.prizeMode]: e.target.value,
                  },
                })
              }
              className={inputClass}
            />
          </div>
        )}
      </div>

      {draft.entryFee.trim() !== '' && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-gray-700">Доля и призы</span>
          <div className="inline-flex rounded-lg border border-gray-300 p-0.5">
            {prizeModes.map((mode) => (
              <button
                key={mode}
                type="button"
                disabled={readOnly}
                onClick={() => setDraft({ ...draft, prizeMode: mode })}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  draft.prizeMode === mode
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {PRIZE_MODE_LABELS[mode]}
              </button>
            ))}
          </div>
        </div>
      )}

      {draft.entryFee.trim() !== '' && (
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
            <span className="text-sm font-medium text-gray-700">
              Призы по местам
            </span>
            <span
              className={`text-xs ${totalOk ? 'text-green-600' : 'text-red-600'}`}
            >
              {isPercent
                ? `Сумма: ${total}%`
                : `Сумма: ${formatRubles(total)}${
                    fund === null ? '' : ` из ${formatRubles(fund)}`
                  }`}
            </span>
          </div>

          {!readOnly && isPercent && (
            <div className="flex flex-wrap gap-2 mb-3">
              {PRIZE_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setValues(preset.percents.map(String))}
                  className="px-3 py-1 rounded-full text-xs font-medium border bg-white text-gray-600 border-gray-300 hover:border-blue-400"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}

          <div className="space-y-2">
            {values.map((value, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-sm text-gray-600">
                  {i + 1} место
                </span>
                <input
                  type="number"
                  min={1}
                  max={isPercent ? 100 : undefined}
                  step={1}
                  inputMode="numeric"
                  value={value}
                  disabled={readOnly}
                  onChange={(e) =>
                    setValues(
                      values.map((v, j) => (j === i ? e.target.value : v)),
                    )
                  }
                  className={`${inputClass} ${isPercent ? 'max-w-24' : 'max-w-36'}`}
                />
                <span className="text-sm text-gray-500">
                  {isPercent ? '%' : '₽'}
                </span>
                {!readOnly && i === values.length - 1 && values.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setValues(values.slice(0, -1))}
                    className="text-xs text-gray-500 hover:text-red-600"
                  >
                    Убрать
                  </button>
                )}
              </div>
            ))}
          </div>
          {!readOnly && values.length < MAX_PRIZE_PLACES && (
            <button
              type="button"
              onClick={() => setValues([...values, ''])}
              className="mt-2 text-sm text-blue-600 hover:text-blue-700"
            >
              + место
            </button>
          )}
          <p className="mt-2 text-xs text-gray-500">
            {isPercent
              ? 'Если места делятся (например, 3–4 без матча за третье), их доли складываются и делятся поровну.'
              : 'Призы вместе с долей организатора не могут превышать собранные взносы. Если места делятся (например, 3–4), их призы складываются и делятся поровну.'}
          </p>
        </div>
      )}

      {preview && (
        <div className="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
          При {participantsCount} участниках: собрано{' '}
          {formatRubles(preview.collected)}, организатору{' '}
          {formatRubles(preview.organizerShare)}, призовой фонд{' '}
          {formatRubles(preview.prizeFund)}
          {preview.remainder > 0 &&
            `, остаток ${formatRubles(preview.remainder)}`}
          .
        </div>
      )}

      {error && dirty && <div className="text-sm text-red-600">{error}</div>}
      {save.error && (
        <div className="text-sm text-red-600">{save.error.message}</div>
      )}

      {!readOnly && (
        <button
          type="submit"
          disabled={!dirty || error !== null || save.isPending}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {save.isPending ? 'Сохранение...' : 'Сохранить'}
        </button>
      )}
    </form>
  );
}

function PrizeReport({ tournament }: { tournament: ApiTournament }) {
  const {
    data: report,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['tournament-prizes', tournament.id],
    queryFn: () => tournamentsApi.prizes(tournament.id),
  });

  if (isLoading) {
    return <div className="text-gray-500 text-sm">Загрузка...</div>;
  }
  if (error) {
    return <div className="text-sm text-red-600">{error.message}</div>;
  }
  if (!report) {
    return (
      <div className="text-gray-500 text-sm">
        Взнос не задан — турнир бесплатный.
      </div>
    );
  }

  const { summary, rows, isFinal } = report;

  return (
    <div className="space-y-4">
      {summary.remainder < 0 && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          Призы и доля организатора превышают собранные взносы на{' '}
          {formatRubles(-summary.remainder)}: участников меньше, чем было при
          настройке. Уменьшите суммы.
        </div>
      )}
      {!isFinal && (
        <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Прогноз: турнир ещё не завершён. После финала здесь появятся игроки и
          их выплаты.
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <InfoRow label="Участники" value={String(summary.participantsCount)} />
        <InfoRow label="Взнос" value={formatRubles(summary.entryFee)} />
        <InfoRow label="Собрано" value={formatRubles(summary.collected)} />
        <InfoRow
          label={
            summary.prizeMode === 'percent'
              ? `Организатору (${summary.organizerFeePercent}%)`
              : 'Организатору'
          }
          value={formatRubles(summary.organizerShare)}
        />
        <InfoRow
          label="Призовой фонд"
          value={formatRubles(summary.prizeFund)}
        />
        {summary.remainder > 0 && (
          <InfoRow
            label="Остаток"
            value={
              <>
                {formatRubles(summary.remainder)}{' '}
                <span className="text-gray-500">
                  (округление и незанятые места — организатору)
                </span>
              </>
            }
          />
        )}
      </div>

      <div className="rounded-lg border border-gray-200 overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-gray-500 text-xs">
              <th className="px-3 py-2 text-left font-medium">Место</th>
              {isFinal && (
                <th className="px-3 py-2 text-left font-medium">Игрок</th>
              )}
              <th className="px-3 py-2 text-right font-medium">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={row.userId ?? `place-${row.placeFrom}`}
                className={i > 0 ? 'border-t border-gray-100' : undefined}
              >
                <td className="px-3 py-1.5 text-gray-500">
                  {formatPlaceRange(row.placeFrom, row.placeTo)}
                </td>
                {isFinal && <td className="px-3 py-1.5">{playerName(row)}</td>}
                <td
                  className={`px-3 py-1.5 text-right tabular-nums ${
                    row.amount > 0
                      ? 'text-gray-900 font-medium'
                      : 'text-gray-400'
                  }`}
                >
                  {row.amount > 0 ? formatRubles(row.amount) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-200 bg-gray-50">
              <td
                colSpan={isFinal ? 2 : 1}
                className="px-3 py-2 text-gray-600 font-medium"
              >
                Итого выплат
              </td>
              <td className="px-3 py-2 text-right tabular-nums font-medium">
                {formatRubles(summary.paidOut)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

export default function PrizesTab({
  tournament,
}: {
  tournament: ApiTournament;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2 items-start">
      <FinanceForm key={tournament.id} tournament={tournament} />
      <PrizeReport tournament={tournament} />
    </div>
  );
}
