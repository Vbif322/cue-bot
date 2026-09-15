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

  // t_<uuid> — кнопка «Участвовать» под анонсом в групповом чате.
  it('parses a t_<uuid> payload', () => {
    expect(parseStartPayload('t_11111111-2222-4333-8444-555555555555')).toEqual(
      {
        kind: 'tournament',
        tournamentId: '11111111-2222-4333-8444-555555555555',
      },
    );
  });

  it('accepts an uppercase uuid', () => {
    expect(parseStartPayload('t_AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE')).toEqual(
      {
        kind: 'tournament',
        tournamentId: 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE',
      },
    );
  });

  it('returns null for t_ without a valid uuid', () => {
    // Без этой проверки мусор доехал бы до Postgres и упал там на приведении типа.
    expect(parseStartPayload('t_')).toBeNull();
    expect(parseStartPayload('t_notauuid')).toBeNull();
    expect(parseStartPayload('t_11111111-2222-4333-8444')).toBeNull();
    expect(
      parseStartPayload('t_11111111-2222-4333-8444-555555555555-extra'),
    ).toBeNull();
  });

  it('payload укладывается в лимит Telegram', () => {
    expect('t_11111111-2222-4333-8444-555555555555'.length).toBeLessThanOrEqual(
      64,
    );
  });
});
