import { describe, expect, it } from 'vitest';

import { parseStartPayload } from '@/bot/handlers/inviteCommands.js';

describe('parseStartPayload', () => {
  it('parses a join_<code> payload', () => {
    expect(parseStartPayload('join_AbC123')).toEqual({
      kind: 'join',
      code: 'AbC123',
    });
  });

  it('returns null for an empty / missing payload', () => {
    expect(parseStartPayload(undefined)).toBeNull();
    expect(parseStartPayload('')).toBeNull();
  });

  it('returns null for join_ with no code', () => {
    expect(parseStartPayload('join_')).toBeNull();
  });

  it('returns null for unrelated payloads', () => {
    expect(parseStartPayload('ref_xyz')).toBeNull();
    expect(parseStartPayload('hello')).toBeNull();
  });
});
