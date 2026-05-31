import { describe, expect, it } from 'vitest';

import { DateTimeHelperInstance } from '@/utils/dateTimeHelper.js';

const h = DateTimeHelperInstance;

describe('DateTimeHelper.toDate', () => {
  it('parses dd.MM.yyyy and defaults the time to 10:00 UTC', () => {
    const res = h.toDate('15.03.2024');
    expect(res.status).toBe(true);
    if (!res.status) throw new Error('expected success');
    expect(res.datetime.getUTCFullYear()).toBe(2024);
    expect(res.datetime.getUTCMonth()).toBe(2); // March (0-based)
    expect(res.datetime.getUTCDate()).toBe(15);
    expect(res.datetime.getUTCHours()).toBe(10); // date-only -> 10:00
  });

  it('keeps the explicit time for a datetime string', () => {
    const res = h.toDate('15.03.2024 14:30');
    expect(res.status).toBe(true);
    if (!res.status) throw new Error('expected success');
    expect(res.datetime.getUTCHours()).toBe(14);
    expect(res.datetime.getUTCMinutes()).toBe(30);
  });

  it('parses ISO datetime with an explicit zone', () => {
    const res = h.toDate('2024-03-15T14:30:00Z');
    expect(res.status).toBe(true);
    if (!res.status) throw new Error('expected success');
    expect(res.datetime.getUTCHours()).toBe(14);
    expect(res.datetime.getUTCMinutes()).toBe(30);
  });

  it('parses ISO date-only and defaults the time to 10:00 UTC', () => {
    const res = h.toDate('2024-03-15');
    expect(res.status).toBe(true);
    if (!res.status) throw new Error('expected success');
    expect(res.datetime.getUTCHours()).toBe(10);
  });

  it('parses a 13-digit unix millisecond timestamp', () => {
    const res = h.toDate('1710505800000');
    expect(res.status).toBe(true);
    if (!res.status) throw new Error('expected success');
    expect(res.datetime).toBeInstanceOf(Date);
  });

  it.each(['', '   ', 'not-a-date', '32.13.2024'])(
    'rejects invalid input %p',
    (input) => {
      expect(h.toDate(input)).toEqual({ status: false });
    },
  );
});

describe('DateTimeHelper.formatDate', () => {
  it('returns a placeholder for null/undefined', () => {
    expect(h.formatDate(null)).toBe('Дата не указана');
    expect(h.formatDate(undefined)).toBe('Дата не указана');
  });

  it('formats a date with the default format in UTC', () => {
    const date = new Date(Date.UTC(2024, 2, 15, 14, 30));
    expect(h.formatDate(date)).toBe('15.03.2024 14:30');
  });

  it('honours a custom format', () => {
    const date = new Date(Date.UTC(2024, 2, 15, 14, 30));
    expect(h.formatDate(date, 'yyyy')).toBe('2024');
  });
});
