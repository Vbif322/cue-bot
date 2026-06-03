import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/db.js';
import { tournamentParticipants } from '@/db/schema.js';
import { getTournaments, getUserTournaments } from '@/services/tournamentService.js';

import { createTournament, createUser } from '../helpers/factories.js';
import { truncateAll } from '../helpers/truncate.js';

describe('tournament visibility', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('getTournaments hides private tournaments by default', async () => {
    const publicT = await createTournament({
      status: 'registration_open',
      visibility: 'public',
    });
    await createTournament({
      status: 'registration_open',
      visibility: 'private',
    });

    const visible = await getTournaments({
      statuses: ['registration_open'],
    });

    expect(visible.map((t) => t.id)).toEqual([publicT.id]);
  });

  it('getTournaments includes private tournaments when includePrivate=true', async () => {
    await createTournament({
      status: 'registration_open',
      visibility: 'public',
    });
    await createTournament({
      status: 'registration_open',
      visibility: 'private',
    });

    const visible = await getTournaments({
      statuses: ['registration_open'],
      includePrivate: true,
    });

    expect(visible).toHaveLength(2);
  });

  it('getUserTournaments surfaces a private tournament the user participates in', async () => {
    const user = await createUser();
    const priv = await createTournament({
      status: 'registration_open',
      visibility: 'private',
    });
    await db.insert(tournamentParticipants).values({
      tournamentId: priv.id,
      userId: user.id,
      status: 'confirmed',
    });

    const mine = await getUserTournaments(user.id);

    expect(mine.map((t) => t.id)).toEqual([priv.id]);
  });
});
