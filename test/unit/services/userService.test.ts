import { describe, expect, it } from 'vitest';

import {
  MAX_NAME_LENGTH,
  MAX_SURNAME_LENGTH,
  ProfileValidationError,
  normalizeProfileValue,
} from '@/services/userService.js';

describe('normalizeProfileValue', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeProfileValue('  Иван  ', MAX_NAME_LENGTH, 'Имя')).toBe(
      'Иван',
    );
  });

  it('treats blank input as a clear (null)', () => {
    expect(normalizeProfileValue('   ', MAX_NAME_LENGTH, 'Имя')).toBeNull();
    expect(normalizeProfileValue('', MAX_NAME_LENGTH, 'Имя')).toBeNull();
  });

  it('accepts a value at the max length', () => {
    const value = 'a'.repeat(MAX_NAME_LENGTH);
    expect(normalizeProfileValue(value, MAX_NAME_LENGTH, 'Имя')).toBe(value);
  });

  it('throws ProfileValidationError when too long', () => {
    const tooLong = 'a'.repeat(MAX_SURNAME_LENGTH + 1);
    expect(() =>
      normalizeProfileValue(tooLong, MAX_SURNAME_LENGTH, 'Фамилия'),
    ).toThrow(ProfileValidationError);
  });
});
