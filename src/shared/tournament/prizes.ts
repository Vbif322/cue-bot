// Entry fee + prize fund arithmetic (M3, stage 1: calculation only — the bot
// never moves money). Shared layer: imported by the Drizzle schema and services
// directly, and by the React SPA via the `@server/apiTypes` re-export (live
// preview in the tournament form). Keep this file dependency-free so it stays
// safe to bundle into the client.
//
// All amounts are whole rubles.

/**
 * The unit of the organizer's cut and of the `prizeDistribution` values:
 * `percent` — whole percents (of everything collected / of the prize fund);
 * `fixed` — whole rubles.
 */
export const prizeModes = ['percent', 'fixed'] as const;

export type IPrizeMode = (typeof prizeModes)[number];

export const PRIZE_MODE_LABELS: Record<IPrizeMode, string> = {
  percent: 'В процентах',
  fixed: 'В рублях',
};

/** One finishing place: percent or rubles, depending on the prize mode. */
export interface IPrizePlace {
  place: number;
  value: number;
}

/** Ordered by place, places contiguous from 1. */
export type IPrizeDistribution = IPrizePlace[];

export const MAX_PRIZE_PLACES = 32;

/** Percent-mode templates. */
export const PRIZE_PRESETS: readonly {
  label: string;
  percents: readonly number[];
}[] = [
  { label: 'Победитель забирает всё', percents: [100] },
  { label: '60 / 40', percents: [60, 40] },
  { label: '50 / 30 / 20', percents: [50, 30, 20] },
  { label: '40 / 25 / 15 / 10 / 10', percents: [40, 25, 15, 10, 10] },
];

/**
 * Validate a prize distribution. Returns an error string (Russian) or null.
 * Places must run 1..n without gaps and each value must be a positive whole
 * number; in `percent` mode the values must add up to exactly 100.
 */
export function validatePrizeDistribution(
  value: unknown,
  mode: IPrizeMode,
): string | null {
  if (!Array.isArray(value) || value.length === 0) {
    return 'Не задано распределение призов по местам';
  }
  if (value.length > MAX_PRIZE_PLACES) {
    return `Призовых мест не может быть больше ${String(MAX_PRIZE_PLACES)}`;
  }

  let total = 0;
  for (const [i, entry] of (value as unknown[]).entries()) {
    if (typeof entry !== 'object' || entry === null) {
      return 'Некорректное распределение призов';
    }
    const { place, value: v } = entry as Record<string, unknown>;
    if (place !== i + 1) {
      return 'Призовые места должны идти подряд, начиная с 1';
    }
    if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
      return mode === 'percent'
        ? `Доля ${String(place)} места должна быть целым числом процентов больше нуля`
        : `Приз за ${String(place)} место должен быть целым числом рублей больше нуля`;
    }
    total += v;
  }

  if (mode === 'percent' && total !== 100) {
    return `Сумма долей должна быть 100%, сейчас ${String(total)}%`;
  }
  return null;
}

export interface IFinanceSettings {
  /** Whole rubles; null = free tournament (no fund, no prizes). */
  entryFee: number | null;
  /** `percent` mode: 0..100 — the organizer's cut of everything collected. */
  organizerFeePercent: number;
  /** `fixed` mode: the organizer's cut in whole rubles, whatever the turnout. */
  organizerFeeAmount: number;
  prizeMode: IPrizeMode;
  prizeDistribution: IPrizeDistribution | null;
}

/** What the organizer's cut and the prize fund depend on. */
export type IFundSettings = Pick<
  IFinanceSettings,
  'organizerFeePercent' | 'organizerFeeAmount' | 'prizeMode'
> & { entryFee: number };

/**
 * The organizer's cut of `collected`: a percent (rounded down) in `percent`
 * mode, a fixed ruble amount in `fixed` mode — the same unit as the prizes.
 */
export function organizerShareFor(s: IFundSettings, collected: number): number {
  return s.prizeMode === 'percent'
    ? Math.floor((collected * s.organizerFeePercent) / 100)
    : s.organizerFeeAmount;
}

/**
 * collected − the organizer's cut. Negative in `fixed` mode when the fixed cut
 * exceeds what the turnout brought in.
 */
export function prizeFundFor(
  s: IFundSettings,
  participantsCount: number,
): number {
  const collected = s.entryFee * participantsCount;
  return collected - organizerShareFor(s, collected);
}

/**
 * Validate the finance settings as a whole. A free tournament (no entry fee)
 * needs nothing else; a paid one needs a valid distribution. In `fixed` mode
 * the prizes plus the organizer's cut must fit into the entry fees collected
 * from `participantsCount` players — nobody tops the fund up.
 */
export function validateFinanceSettings(
  s: IFinanceSettings,
  participantsCount: number,
): string | null {
  if (!(prizeModes as readonly string[]).includes(s.prizeMode)) {
    return 'Неизвестный способ распределения призов';
  }
  if (
    !Number.isInteger(s.organizerFeePercent) ||
    s.organizerFeePercent < 0 ||
    s.organizerFeePercent > 100
  ) {
    return 'Доля организатора должна быть целым числом от 0 до 100%';
  }
  if (!Number.isInteger(s.organizerFeeAmount) || s.organizerFeeAmount < 0) {
    return 'Доля организатора должна быть целым неотрицательным числом рублей';
  }
  if (s.entryFee === null) return null;
  if (!Number.isInteger(s.entryFee) || s.entryFee <= 0) {
    return 'Взнос должен быть целым положительным числом рублей';
  }

  const error = validatePrizeDistribution(s.prizeDistribution, s.prizeMode);
  if (error) return error;

  if (s.prizeMode === 'fixed') {
    const prizes = (s.prizeDistribution ?? []).reduce((t, p) => t + p.value, 0);
    const collected = s.entryFee * participantsCount;
    if (prizes + s.organizerFeeAmount > collected) {
      return (
        `Призы (${formatRubles(prizes)}) и доля организатора ` +
        `(${formatRubles(s.organizerFeeAmount)}) больше собранных взносов ` +
        `(${formatRubles(collected)}) при ${String(participantsCount)} участниках`
      );
    }
  }
  return null;
}

/**
 * Turnout the prize calculation assumes before the tournament ends: the count
 * frozen at registration close, else the live confirmed count, else — nobody
 * registered yet — the participant cap.
 */
export function expectedParticipants(t: {
  confirmedParticipants: number | null;
  confirmedCount: number;
  maxParticipants: number;
}): number {
  return t.confirmedParticipants ?? (t.confirmedCount || t.maxParticipants);
}

/** A run of finishing places shared by `userIds` (e.g. 3–4 in a bracket). */
export interface IPlacementGroup<Id extends string = string> {
  placeFrom: number;
  placeTo: number;
  userIds: Id[];
}

export interface IPrizeRow<Id extends string = string> {
  placeFrom: number;
  placeTo: number;
  /** Null in a forecast (results not known yet). */
  userId: Id | null;
  amount: number;
}

export interface IPrizeSummary {
  participantsCount: number;
  entryFee: number;
  organizerFeePercent: number;
  organizerFeeAmount: number;
  prizeMode: IPrizeMode;
  /** entryFee × participantsCount. */
  collected: number;
  organizerShare: number;
  /** collected − organizerShare. */
  prizeFund: number;
  /** Sum of all row amounts. */
  paidOut: number;
  /**
   * prizeFund − paidOut: rounding down to whole rubles, plus the prizes of
   * places nobody reached (fewer players than prize places). Goes to the
   * organizer, so collected = organizerShare + paidOut + remainder.
   *
   * Negative only in `fixed` mode when fewer players came than the prizes and
   * the organizer's cut were sized for: they no longer fit the entry fees
   * collected and must be lowered.
   */
  remainder: number;
}

export interface IPrizeReport<Id extends string = string> {
  summary: IPrizeSummary;
  rows: IPrizeRow<Id>[];
}

function valueForPlaces(
  distribution: IPrizeDistribution,
  placeFrom: number,
  placeTo: number,
): number {
  return distribution
    .filter((p) => p.place >= placeFrom && p.place <= placeTo)
    .reduce((sum, p) => sum + p.value, 0);
}

/**
 * Split the fund between finishing places.
 *
 * With `placements` (a finished tournament) every player gets a row: a shared
 * place range pools the prizes of all its places (percents or rubles) and
 * splits them equally, each player's amount rounded down to a whole ruble.
 * Without `placements` the result is a forecast — one row per prize place, no
 * players.
 */
export function computePrizeDistribution<Id extends string = string>(
  settings: IFundSettings & {
    prizeDistribution: IPrizeDistribution;
    participantsCount: number;
  },
  placements?: IPlacementGroup<Id>[],
): IPrizeReport<Id> {
  const {
    entryFee,
    organizerFeePercent,
    organizerFeeAmount,
    prizeMode,
    prizeDistribution,
    participantsCount,
  } = settings;
  const collected = entryFee * participantsCount;
  const organizerShare = organizerShareFor(settings, collected);
  const prizeFund = collected - organizerShare;
  // Rubles for a pooled prize value, split between `players`.
  const share = (value: number, players: number) =>
    prizeMode === 'percent'
      ? Math.floor((prizeFund * value) / (100 * players))
      : Math.floor(value / players);

  const rows: IPrizeRow<Id>[] = [];
  if (placements) {
    for (const group of placements) {
      const amount = share(
        valueForPlaces(prizeDistribution, group.placeFrom, group.placeTo),
        group.userIds.length,
      );
      for (const userId of group.userIds) {
        rows.push({
          placeFrom: group.placeFrom,
          placeTo: group.placeTo,
          userId,
          amount,
        });
      }
    }
  } else {
    for (const p of prizeDistribution) {
      rows.push({
        placeFrom: p.place,
        placeTo: p.place,
        userId: null,
        amount: share(p.value, 1),
      });
    }
  }

  const paidOut = rows.reduce((sum, r) => sum + r.amount, 0);

  return {
    summary: {
      participantsCount,
      entryFee,
      organizerFeePercent,
      organizerFeeAmount,
      prizeMode,
      collected,
      organizerShare,
      prizeFund,
      paidOut,
      remainder: prizeFund - paidOut,
    },
    rows,
  };
}

/** "1", "3–4". */
export function formatPlaceRange(placeFrom: number, placeTo: number): string {
  return placeFrom === placeTo
    ? String(placeFrom)
    : `${String(placeFrom)}–${String(placeTo)}`;
}

/**
 * Whole rubles for display, e.g. 12500 → "12 500 ₽": a narrow no-break space
 * (U+202F) between thousands, a no-break space before the sign.
 */
export function formatRubles(amount: number): string {
  const digits = String(Math.abs(amount)).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    '\u202f',
  );
  return `${amount < 0 ? '−' : ''}${digits}\u00a0₽`;
}
