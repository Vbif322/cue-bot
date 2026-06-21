import type { UUID } from 'crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/db.js';
import { tournamentParticipants } from '@/db/schema.js';
import { registerParticipant } from '@/services/tournamentService.js';

import { createTournament, createUser } from '../helpers/factories.js';
import { truncateAll } from '../helpers/truncate.js';

/** Count rows that occupy a slot (pending/confirmed) for a tournament. */
async function activeCount(tournamentId: UUID): Promise<number> {
  const rows = await db.query.tournamentParticipants.findMany({
    where: (p, { eq, and, inArray }) =>
      and(
        eq(p.tournamentId, tournamentId),
        inArray(p.status, ['pending', 'confirmed']),
      ),
  });
  return rows.length;
}

describe('registerParticipant — atomic, cap-enforcing registration', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('does not exceed maxParticipants under concurrent registrations', async () => {
    const cap = 4;
    const t = await createTournament({
      status: 'registration_open',
      maxParticipants: cap,
    });
    const users = await Promise.all(
      Array.from({ length: cap + 6 }, () => createUser()),
    );

    const outcomes = await Promise.all(
      users.map((u) =>
        registerParticipant(t.id, u.id, {
          desiredStatus: 'pending',
          requireOpen: true,
        }),
      ),
    );

    const ok = outcomes.filter((o) => o.ok);
    const full = outcomes.filter((o) => !o.ok && o.reason === 'full');

    expect(ok).toHaveLength(cap);
    expect(full).toHaveLength(6);
    expect(await activeCount(t.id)).toBe(cap);
  });

  it('rejects registration when the tournament is closed (requireOpen)', async () => {
    const t = await createTournament({ status: 'draft', maxParticipants: 8 });
    const u = await createUser();

    const outcome = await registerParticipant(t.id, u.id, {
      desiredStatus: 'pending',
      requireOpen: true,
    });

    expect(outcome).toEqual({ ok: false, reason: 'registration_closed' });
    expect(await activeCount(t.id)).toBe(0);
  });

  it('admin path (requireOpen: false) can register on a non-open tournament', async () => {
    const t = await createTournament({ status: 'draft', maxParticipants: 8 });
    const u = await createUser();

    const outcome = await registerParticipant(t.id, u.id, {
      desiredStatus: 'confirmed',
      requireOpen: false,
    });

    expect(outcome).toMatchObject({ ok: true, status: 'confirmed' });
    expect(await activeCount(t.id)).toBe(1);
  });

  it('reports already_registered for an active participant', async () => {
    const t = await createTournament({
      status: 'registration_open',
      maxParticipants: 8,
    });
    const u = await createUser();

    const first = await registerParticipant(t.id, u.id, {
      desiredStatus: 'pending',
      requireOpen: true,
    });
    const second = await registerParticipant(t.id, u.id, {
      desiredStatus: 'pending',
      requireOpen: true,
    });

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, reason: 'already_registered' });
    expect(await activeCount(t.id)).toBe(1);
  });

  it('revives a cancelled registration without creating a duplicate row', async () => {
    const t = await createTournament({
      status: 'registration_open',
      maxParticipants: 8,
    });
    const u = await createUser();

    await db.insert(tournamentParticipants).values({
      tournamentId: t.id,
      userId: u.id,
      status: 'cancelled',
    });

    const outcome = await registerParticipant(t.id, u.id, {
      desiredStatus: 'pending',
      requireOpen: true,
    });

    expect(outcome).toMatchObject({ ok: true, reregistered: true });
    expect(await activeCount(t.id)).toBe(1);

    const all = await db.query.tournamentParticipants.findMany({
      where: (p, { eq }) => eq(p.tournamentId, t.id),
    });
    expect(all).toHaveLength(1);
  });

  it('returns not_found for a missing tournament', async () => {
    const u = await createUser();
    const outcome = await registerParticipant(
      '00000000-0000-0000-0000-000000000000' as UUID,
      u.id,
      { desiredStatus: 'pending', requireOpen: true },
    );

    expect(outcome).toEqual({ ok: false, reason: 'not_found' });
  });
});
