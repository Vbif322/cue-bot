import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/db.js';
import { tournaments } from '@/db/schema.js';
import {
  createTournamentDraft,
  getTournament,
} from '@/services/tournamentService.js';
import { eq } from 'drizzle-orm';

import { createUser, createVenue } from '../helpers/factories.js';
import { truncateAll } from '../helpers/truncate.js';

describe('randomAdvancement persistence (createTournamentDraft)', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('persists randomAdvancement=true for double elimination', async () => {
    const venue = await createVenue();
    const admin = await createUser({ role: 'admin' });

    const t = await createTournamentDraft({
      venueId: venue.id,
      name: 'dbl random',
      sport: 'snooker',
      discipline: 'snooker_15_red',
      format: 'double_elimination',
      randomAdvancement: true,
      maxParticipants: 16,
      winScore: 3,
      createdBy: admin.id,
    });

    const row = await db.query.tournaments.findFirst({
      where: eq(tournaments.id, t.id),
    });
    expect(row?.randomAdvancement).toBe(true);
    expect(row?.format).toBe('double_elimination');
  });

  it('defaults randomAdvancement to false when omitted', async () => {
    const venue = await createVenue();
    const admin = await createUser({ role: 'admin' });

    const t = await createTournamentDraft({
      venueId: venue.id,
      name: 'plain',
      sport: 'snooker',
      discipline: 'snooker_15_red',
      format: 'double_elimination',
      maxParticipants: 16,
      winScore: 3,
      createdBy: admin.id,
    });

    expect((await getTournament(t.id))?.randomAdvancement).toBe(false);
  });
});
