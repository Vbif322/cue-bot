import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';

import {
  generateLoginCode,
  hashCode,
  normalizeEmail,
} from '@/app/server/authCrypto.js';

describe('normalizeEmail', () => {
  it('trims surrounding whitespace and lowercases', () => {
    expect(normalizeEmail('  Me@Example.COM ')).toBe('me@example.com');
  });

  it('is idempotent on an already-normalized address', () => {
    expect(normalizeEmail('me@example.com')).toBe('me@example.com');
  });
});

describe('hashCode', () => {
  it('produces a deterministic 64-char sha256 hex digest', () => {
    const digest = hashCode('123456');
    expect(digest).toHaveLength(64);
    expect(digest).toBe(createHash('sha256').update('123456').digest('hex'));
  });

  it('differs for different codes', () => {
    expect(hashCode('123456')).not.toBe(hashCode('123457'));
  });
});

describe('generateLoginCode', () => {
  it('always returns exactly 6 digits (with leading zeros)', () => {
    for (let i = 0; i < 500; i++) {
      expect(generateLoginCode()).toMatch(/^\d{6}$/);
    }
  });
});
