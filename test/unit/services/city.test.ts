import { describe, expect, it } from 'vitest';

import { MAX_CITY_LENGTH, normalizeCity } from '@/shared/city.js';

describe('normalizeCity', () => {
  it('trims, collapses whitespace and capitalises each word part', () => {
    expect(normalizeCity('  санкт-петербург ')).toBe('Санкт-Петербург');
    expect(normalizeCity('нижний   новгород')).toBe('Нижний Новгород');
    expect(normalizeCity('Москва')).toBe('Москва');
  });

  it('treats blank/null as no city', () => {
    expect(normalizeCity('   ')).toBeNull();
    expect(normalizeCity('')).toBeNull();
    expect(normalizeCity(null)).toBeNull();
    expect(normalizeCity(undefined)).toBeNull();
  });

  it('rejects values over the max length', () => {
    expect(() => normalizeCity('а'.repeat(MAX_CITY_LENGTH + 1))).toThrow();
    expect(normalizeCity('а'.repeat(MAX_CITY_LENGTH))).toHaveLength(
      MAX_CITY_LENGTH,
    );
  });
});
