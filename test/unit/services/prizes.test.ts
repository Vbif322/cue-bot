import { describe, expect, it } from 'vitest';

import {
  computePrizeDistribution,
  expectedParticipants,
  formatPlaceRange,
  formatRubles,
  validateFinanceSettings,
  validatePrizeDistribution,
  type IFinanceSettings,
  type IPrizeDistribution,
} from '@/shared/tournament/prizes.js';

const places = (...values: number[]): IPrizeDistribution =>
  values.map((value, i) => ({ place: i + 1, value }));

const split503020 = places(50, 30, 20);

describe('validatePrizeDistribution', () => {
  it('accepts contiguous percents summing to 100', () => {
    expect(validatePrizeDistribution(split503020, 'percent')).toBeNull();
  });

  it('accepts any positive ruble amounts in fixed mode', () => {
    expect(validatePrizeDistribution(places(5000, 3000), 'fixed')).toBeNull();
  });

  it.each([
    [null, /Не задано/],
    [[], /Не задано/],
    [[{ place: 2, value: 100 }], /подряд/],
    [
      [
        { place: 1, value: 50 },
        { place: 3, value: 50 },
      ],
      /подряд/,
    ],
    [places(0, 100), /больше нуля/],
    [places(50.5, 49.5), /целым/],
    [places(60, 30), /90%/],
  ])('percent mode rejects %j', (value, message) => {
    expect(validatePrizeDistribution(value, 'percent')).toMatch(message);
  });

  it.each([[places(0)], [places(-100)], [places(99.5)]])(
    'fixed mode rejects %j',
    (value) => {
      expect(validatePrizeDistribution(value, 'fixed')).toMatch(/рублей/);
    },
  );
});

describe('validateFinanceSettings', () => {
  const paid: IFinanceSettings = {
    entryFee: 1000,
    organizerFeePercent: 10,
    organizerFeeAmount: 0,
    prizeMode: 'percent',
    prizeDistribution: split503020,
  };

  it('a free tournament needs no distribution', () => {
    expect(
      validateFinanceSettings(
        {
          entryFee: null,
          organizerFeePercent: 0,
          organizerFeeAmount: 0,
          prizeMode: 'percent',
          prizeDistribution: null,
        },
        8,
      ),
    ).toBeNull();
  });

  it('a paid tournament needs a distribution', () => {
    expect(
      validateFinanceSettings({ ...paid, prizeDistribution: null }, 8),
    ).toMatch(/Не задано/);
  });

  it.each([-1, 101, 12.5])('rejects organizer share %d%%', (pct) => {
    expect(
      validateFinanceSettings({ ...paid, organizerFeePercent: pct }, 8),
    ).toMatch(/организатора/);
  });

  it.each([-1, 12.5])('rejects organizer amount %d ₽', (amount) => {
    expect(
      validateFinanceSettings({ ...paid, organizerFeeAmount: amount }, 8),
    ).toMatch(/рублей/);
  });

  it.each([0, -100, 99.5])('rejects entry fee %d', (fee) => {
    expect(validateFinanceSettings({ ...paid, entryFee: fee }, 8)).toMatch(
      /Взнос/,
    );
  });

  describe('fixed prizes + organizer cut must fit the fees', () => {
    // 8 players × 1000 = 8000; the organizer takes 800 ₽, not 10%.
    const fixed = (...values: number[]): IFinanceSettings => ({
      ...paid,
      organizerFeePercent: 50,
      organizerFeeAmount: 800,
      prizeMode: 'fixed',
      prizeDistribution: places(...values),
    });

    it('accepts prizes up to the fees minus the cut (the percent is ignored)', () => {
      expect(validateFinanceSettings(fixed(5000, 2200), 8)).toBeNull();
    });

    it('rejects prizes above the fees minus the cut', () => {
      expect(validateFinanceSettings(fixed(5000, 2201), 8)).toMatch(
        /больше собранных взносов/,
      );
    });

    it('the same prizes stop fitting with fewer players', () => {
      expect(validateFinanceSettings(fixed(5000, 2200), 7)).toMatch(
        /при 7 участниках/,
      );
    });
  });
});

describe('expectedParticipants', () => {
  it('frozen count, then live count, then the cap', () => {
    const t = {
      confirmedParticipants: 12,
      confirmedCount: 10,
      maxParticipants: 16,
    };
    expect(expectedParticipants(t)).toBe(12);
    expect(expectedParticipants({ ...t, confirmedParticipants: null })).toBe(
      10,
    );
    expect(
      expectedParticipants({
        ...t,
        confirmedParticipants: null,
        confirmedCount: 0,
      }),
    ).toBe(16);
  });
});

describe('computePrizeDistribution — percent mode', () => {
  const settings = {
    entryFee: 1000,
    organizerFeePercent: 10,
    organizerFeeAmount: 0,
    prizeMode: 'percent' as const,
    prizeDistribution: split503020,
    participantsCount: 16,
  };

  it('forecast: one row per prize place, no players', () => {
    const { summary, rows } = computePrizeDistribution(settings);

    expect(summary).toMatchObject({
      collected: 16000,
      organizerShare: 1600,
      prizeFund: 14400,
      paidOut: 14400,
      remainder: 0,
    });
    expect(rows).toEqual([
      { placeFrom: 1, placeTo: 1, userId: null, amount: 7200 },
      { placeFrom: 2, placeTo: 2, userId: null, amount: 4320 },
      { placeFrom: 3, placeTo: 3, userId: null, amount: 2880 },
    ]);
  });

  it('a shared place range pools its shares and splits them equally', () => {
    const { rows } = computePrizeDistribution(settings, [
      { placeFrom: 1, placeTo: 1, userIds: ['a'] },
      { placeFrom: 2, placeTo: 2, userIds: ['b'] },
      { placeFrom: 3, placeTo: 4, userIds: ['c', 'd'] },
      { placeFrom: 5, placeTo: 8, userIds: ['e', 'f', 'g', 'h'] },
    ]);

    expect(rows.map((r) => [r.userId, r.amount])).toEqual([
      ['a', 7200],
      ['b', 4320],
      // 3rd place's 20% (2880) shared by both semifinal losers.
      ['c', 1440],
      ['d', 1440],
      ['e', 0],
      ['f', 0],
      ['g', 0],
      ['h', 0],
    ]);
  });

  it('rounds each share down and reports the remainder', () => {
    const { summary, rows } = computePrizeDistribution(
      {
        entryFee: 100,
        organizerFeePercent: 0,
        organizerFeeAmount: 0,
        prizeMode: 'percent',
        prizeDistribution: places(34, 33, 33),
        participantsCount: 7,
      },
      [
        { placeFrom: 1, placeTo: 1, userIds: ['a'] },
        { placeFrom: 2, placeTo: 4, userIds: ['b', 'c', 'd'] },
        { placeFrom: 5, placeTo: 7, userIds: ['e', 'f', 'g'] },
      ],
    );

    // Fund 700: 1st 34% = 238; 2–4 pool 66% = 462 → 154 each.
    expect(rows.slice(0, 4).map((r) => r.amount)).toEqual([238, 154, 154, 154]);
    expect(summary.paidOut + summary.remainder).toBe(summary.prizeFund);
    expect(summary.organizerShare + summary.paidOut + summary.remainder).toBe(
      summary.collected,
    );
  });

  it('prize places nobody reached go to the remainder', () => {
    const { summary } = computePrizeDistribution(
      { ...settings, organizerFeePercent: 0, participantsCount: 2 },
      [
        { placeFrom: 1, placeTo: 1, userIds: ['a'] },
        { placeFrom: 2, placeTo: 2, userIds: ['b'] },
      ],
    );
    // 3rd place's 20% of 2000 is not paid out.
    expect(summary).toMatchObject({
      prizeFund: 2000,
      paidOut: 1600,
      remainder: 400,
    });
  });

  it('organizer share is rounded down, the fund keeps the kopecks', () => {
    const { summary } = computePrizeDistribution({
      ...settings,
      entryFee: 333,
      organizerFeePercent: 15,
      participantsCount: 3,
    });
    // 999 × 15% = 149.85 → 149.
    expect(summary).toMatchObject({
      collected: 999,
      organizerShare: 149,
      prizeFund: 850,
    });
  });
});

describe('computePrizeDistribution — fixed mode', () => {
  const settings = {
    entryFee: 1000,
    organizerFeePercent: 0,
    organizerFeeAmount: 800,
    prizeMode: 'fixed' as const,
    prizeDistribution: places(4000, 2000, 1000),
    participantsCount: 8,
  };

  it('forecast pays the set amounts, the rest of the fund is remainder', () => {
    const { summary, rows } = computePrizeDistribution(settings);

    expect(rows.map((r) => r.amount)).toEqual([4000, 2000, 1000]);
    expect(summary).toMatchObject({
      prizeMode: 'fixed',
      collected: 8000,
      organizerShare: 800,
      prizeFund: 7200,
      paidOut: 7000,
      remainder: 200,
    });
  });

  it('a shared place range pools the amounts and splits them equally', () => {
    const { rows } = computePrizeDistribution(
      { ...settings, prizeDistribution: places(4000, 2000, 1001) },
      [
        { placeFrom: 1, placeTo: 1, userIds: ['a'] },
        { placeFrom: 2, placeTo: 2, userIds: ['b'] },
        { placeFrom: 3, placeTo: 4, userIds: ['c', 'd'] },
        { placeFrom: 5, placeTo: 8, userIds: ['e', 'f', 'g', 'h'] },
      ],
    );
    expect(rows.map((r) => r.amount)).toEqual([
      4000, 2000, 500, 500, 0, 0, 0, 0,
    ]);
  });

  it('a negative remainder flags prizes that outgrew a smaller turnout', () => {
    // Sized for 8 players, only 6 came: 6000 − 800 ₽ cut = 5200 < 7000 of prizes.
    const { summary } = computePrizeDistribution({
      ...settings,
      participantsCount: 6,
    });
    expect(summary).toMatchObject({ organizerShare: 800, remainder: -1800 });
  });
});

describe('formatting', () => {
  it('formatPlaceRange', () => {
    expect(formatPlaceRange(1, 1)).toBe('1');
    expect(formatPlaceRange(3, 4)).toBe('3–4');
  });

  it('formatRubles', () => {
    expect(formatRubles(0)).toBe('0 ₽');
    expect(formatRubles(12500)).toBe('12 500 ₽');
    expect(formatRubles(1234567)).toBe('1 234 567 ₽');
  });
});
