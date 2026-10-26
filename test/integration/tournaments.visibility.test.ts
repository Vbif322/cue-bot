import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/db.js';
import { tournamentParticipants, visibilities } from '@/db/schema.js';
import {
  getTournaments,
  getUserTournaments,
} from '@/services/tournamentService.js';

import {
  createFederation,
  createTournament,
  createUser,
  createVenue,
} from '../helpers/factories.js';
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

  it('getTournaments lists every visibility when visibilityIn covers them', async () => {
    await createTournament({
      status: 'registration_open',
      visibility: 'public',
    });
    await createTournament({
      status: 'registration_open',
      visibility: 'unlisted',
    });
    await createTournament({
      status: 'registration_open',
      visibility: 'private',
    });

    const visible = await getTournaments({
      statuses: ['registration_open'],
      visibilityIn: visibilities,
    });

    expect(visible).toHaveLength(3);
  });

  it('getTournaments hides unlisted tournaments from the public feed', async () => {
    const publicT = await createTournament({
      status: 'registration_open',
      visibility: 'public',
    });
    await createTournament({
      status: 'registration_open',
      visibility: 'unlisted',
    });

    const visible = await getTournaments({ statuses: ['registration_open'] });

    expect(visible.map((t) => t.id)).toEqual([publicT.id]);
  });

  it('getTournaments scoped to federations excludes platform tournaments (NULL)', async () => {
    const owner = await createUser();
    const fed = await createFederation({ ownerId: owner.id });
    const other = await createFederation({ ownerId: owner.id });
    const inFed = await createTournament({
      status: 'registration_open',
      federationId: fed.id,
    });
    await createTournament({
      status: 'registration_open',
      federationId: other.id,
    });
    await createTournament({ status: 'registration_open' }); // platform (NULL)

    const scoped = await getTournaments({
      visibilityIn: visibilities,
      scope: { kind: 'federations', ids: [fed.id] },
    });
    expect(scoped.map((t) => t.id)).toEqual([inFed.id]);

    const empty = await getTournaments({
      visibilityIn: visibilities,
      scope: { kind: 'federations', ids: [] },
    });
    expect(empty).toEqual([]);

    const platformOnly = await getTournaments({
      visibilityIn: visibilities,
      federationId: null,
    });
    expect(platformOnly).toHaveLength(1);
    expect(platformOnly[0]?.federationId).toBeNull();
  });

  it('getTournaments filters by venue city case-insensitively', async () => {
    const venue = await createVenue({ city: 'Казань' });
    const inCity = await createTournament({
      status: 'registration_open',
      venueId: venue.id,
    });
    await createTournament({ status: 'registration_open' });

    const list = await getTournaments({ city: 'казань' });
    expect(list.map((t) => t.id)).toEqual([inCity.id]);
    expect(list[0]?.venueCity).toBe('Казань');
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
