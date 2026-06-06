import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/db.js';
import { tournamentParticipants } from '@/db/schema.js';
import {
  ensureInviteCode,
  getTournamentByInviteCode,
  getUserTournaments,
} from '@/services/tournamentService.js';

import { createTournament, createUser } from '../helpers/factories.js';
import { truncateAll } from '../helpers/truncate.js';

describe('tournament invitations', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('ensureInviteCode is idempotent and round-trips via getTournamentByInviteCode', async () => {
    const t = await createTournament({ visibility: 'private' });

    const code = await ensureInviteCode(t.id);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);

    const again = await ensureInviteCode(t.id);
    expect(again).toBe(code);

    const found = await getTournamentByInviteCode(code);
    expect(found?.id).toBe(t.id);
  });

  it('getTournamentByInviteCode returns null for an unknown code', async () => {
    expect(await getTournamentByInviteCode('nope')).toBeNull();
  });

  it('accepts an invited participant row and surfaces it in getUserTournaments', async () => {
    const user = await createUser();
    const t = await createTournament({
      status: 'registration_open',
      visibility: 'private',
    });

    await db.insert(tournamentParticipants).values({
      tournamentId: t.id,
      userId: user.id,
      status: 'invited',
    });

    const mine = await getUserTournaments(user.id);
    expect(mine.map((row) => row.id)).toEqual([t.id]);
  });
});
