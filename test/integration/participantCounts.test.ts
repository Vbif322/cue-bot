import type { UUID } from 'crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/db.js';
import { tournamentParticipants } from '@/db/schema.js';
import type { ParticipantStatus } from '@/db/schema.js';
import { getTournament, getTournaments } from '@/services/tournamentService.js';

import { createTournament, createUser } from '../helpers/factories.js';
import { truncateAll } from '../helpers/truncate.js';

/** Register a freshly-created user into a tournament with the given status. */
async function addParticipant(tournamentId: UUID, status: ParticipantStatus) {
  const user = await createUser();
  await db.insert(tournamentParticipants).values({
    tournamentId,
    userId: user.id,
    status,
  });
}

describe('live participant counts on the tournament read model', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('counts confirmed and pending separately while registration is open', async () => {
    const t = await createTournament({ status: 'registration_open' });
    await addParticipant(t.id, 'confirmed');
    await addParticipant(t.id, 'confirmed');
    await addParticipant(t.id, 'pending');

    const read = await getTournament(t.id);

    expect(read?.confirmedCount).toBe(2);
    expect(read?.pendingCount).toBe(1);
  });

  it('excludes cancelled, invited and disqualified from both counts', async () => {
    const t = await createTournament({ status: 'registration_open' });
    await addParticipant(t.id, 'confirmed');
    await addParticipant(t.id, 'cancelled');
    await addParticipant(t.id, 'invited');
    await addParticipant(t.id, 'disqualified');

    const read = await getTournament(t.id);

    expect(read?.confirmedCount).toBe(1);
    expect(read?.pendingCount).toBe(0);
  });

  it('reports zero counts for a tournament with no participants', async () => {
    const t = await createTournament({ status: 'registration_open' });

    const read = await getTournament(t.id);

    expect(read?.confirmedCount).toBe(0);
    expect(read?.pendingCount).toBe(0);
  });

  it('computes per-tournament counts in list queries without bleed across tournaments', async () => {
    const a = await createTournament({ status: 'registration_open' });
    const b = await createTournament({ status: 'registration_open' });
    await addParticipant(a.id, 'confirmed');
    await addParticipant(a.id, 'pending');
    await addParticipant(b.id, 'confirmed');

    const list = await getTournaments({ statuses: ['registration_open'] });
    const byId = new Map(list.map((t) => [t.id, t]));

    expect(byId.get(a.id)?.confirmedCount).toBe(1);
    expect(byId.get(a.id)?.pendingCount).toBe(1);
    expect(byId.get(b.id)?.confirmedCount).toBe(1);
    expect(byId.get(b.id)?.pendingCount).toBe(0);
  });
});
