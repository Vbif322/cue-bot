import type { UUID } from 'crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/db.js';
import { tournamentParticipants } from '@/db/schema.js';
import type { ParticipantStatus } from '@/db/schema.js';
import {
  acceptInvitation,
  cancelRegistration,
  declineInvitation,
  inviteParticipant,
  registerParticipant,
} from '@/services/tournamentService.js';

import {
  createConfirmedParticipant,
  createTournament,
  createUser,
} from '../helpers/factories.js';
import { truncateAll } from '../helpers/truncate.js';

/** Insert a participant row with an arbitrary status; returns the userId. */
async function addParticipant(
  tournamentId: UUID,
  status: ParticipantStatus,
  seed: number | null = null,
): Promise<UUID> {
  const user = await createUser();
  await db
    .insert(tournamentParticipants)
    .values({ tournamentId, userId: user.id, status, seed });
  return user.id;
}

/** Read a single participant row by (tournamentId, userId). */
async function participation(tournamentId: UUID, userId: UUID) {
  return db.query.tournamentParticipants.findFirst({
    where: (p, { eq, and }) =>
      and(eq(p.tournamentId, tournamentId), eq(p.userId, userId)),
  });
}

const MISSING = '00000000-0000-0000-0000-000000000000' as UUID;

describe('cancelRegistration', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('cancels an active registration, clearing the seed', async () => {
    const t = await createTournament({ status: 'registration_open' });
    const userId = await addParticipant(t.id, 'confirmed', 3);

    const outcome = await cancelRegistration(t.id, userId);

    expect(outcome).toEqual({ ok: true });
    const row = await participation(t.id, userId);
    expect(row?.status).toBe('cancelled');
    expect(row?.seed).toBeNull();
  });

  it('allows re-registration after cancellation (revives the row)', async () => {
    const t = await createTournament({ status: 'registration_open' });
    const userId = await addParticipant(t.id, 'confirmed');

    await cancelRegistration(t.id, userId);
    const outcome = await registerParticipant(t.id, userId, {
      desiredStatus: 'pending',
      requireOpen: true,
    });

    expect(outcome).toMatchObject({ ok: true, reregistered: true });
    const all = await db.query.tournamentParticipants.findMany({
      where: (p, { eq }) => eq(p.tournamentId, t.id),
    });
    expect(all).toHaveLength(1);
    expect(all[0]?.status).toBe('pending');
  });

  it('refuses to cancel once the tournament has started', async () => {
    const t = await createTournament({ status: 'in_progress' });
    const userId = await addParticipant(t.id, 'confirmed');

    const outcome = await cancelRegistration(t.id, userId);

    expect(outcome).toEqual({ ok: false, reason: 'tournament_started' });
    expect((await participation(t.id, userId))?.status).toBe('confirmed');
  });

  it('reports not_registered when there is no active participation', async () => {
    const t = await createTournament({ status: 'registration_open' });
    const u = await createUser();

    expect(await cancelRegistration(t.id, u.id)).toEqual({
      ok: false,
      reason: 'not_registered',
    });
  });

  it('reports not_found for a missing tournament', async () => {
    const u = await createUser();
    expect(await cancelRegistration(MISSING, u.id)).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });
});

describe('inviteParticipant', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('invites a fresh user (creates an invited row)', async () => {
    const t = await createTournament({ status: 'registration_open' });
    const u = await createUser();

    const outcome = await inviteParticipant(t.id, u.id);

    expect(outcome).toEqual({ ok: true });
    expect((await participation(t.id, u.id))?.status).toBe('invited');
  });

  it('revives a cancelled row into invited without duplicating', async () => {
    const t = await createTournament({ status: 'registration_open' });
    const userId = await addParticipant(t.id, 'cancelled', 5);

    const outcome = await inviteParticipant(t.id, userId);

    expect(outcome).toEqual({ ok: true });
    const all = await db.query.tournamentParticipants.findMany({
      where: (p, { eq }) => eq(p.tournamentId, t.id),
    });
    expect(all).toHaveLength(1);
    expect(all[0]?.status).toBe('invited');
    expect(all[0]?.seed).toBeNull();
  });

  it('reports already_participant for an active/invited participant', async () => {
    const t = await createTournament({ status: 'registration_open' });
    const userId = await addParticipant(t.id, 'pending');

    expect(await inviteParticipant(t.id, userId)).toEqual({
      ok: false,
      reason: 'already_participant',
    });
  });

  it('reports full when the cap is reached', async () => {
    const t = await createTournament({
      status: 'registration_open',
      maxParticipants: 2,
    });
    await createConfirmedParticipant(t.id);
    await createConfirmedParticipant(t.id);
    const u = await createUser();

    expect(await inviteParticipant(t.id, u.id)).toEqual({
      ok: false,
      reason: 'full',
    });
  });

  it('reports not_found for a missing tournament', async () => {
    const u = await createUser();
    expect(await inviteParticipant(MISSING, u.id)).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });
});

describe('acceptInvitation', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('confirms an invited participant', async () => {
    const t = await createTournament({ status: 'registration_open' });
    const userId = await addParticipant(t.id, 'invited');

    const outcome = await acceptInvitation(t.id, userId);

    expect(outcome).toEqual({ ok: true });
    expect((await participation(t.id, userId))?.status).toBe('confirmed');
  });

  it('reports full when no slots remain', async () => {
    const t = await createTournament({
      status: 'registration_open',
      maxParticipants: 1,
    });
    await createConfirmedParticipant(t.id);
    const userId = await addParticipant(t.id, 'invited');

    const outcome = await acceptInvitation(t.id, userId);

    expect(outcome).toEqual({ ok: false, reason: 'full' });
    expect((await participation(t.id, userId))?.status).toBe('invited');
  });

  it('reports not_invited when the participant is not in invited status', async () => {
    const t = await createTournament({ status: 'registration_open' });
    const userId = await addParticipant(t.id, 'pending');

    expect(await acceptInvitation(t.id, userId)).toEqual({
      ok: false,
      reason: 'not_invited',
    });
  });
});

describe('declineInvitation', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('cancels an invited participant, clearing the seed', async () => {
    const t = await createTournament({ status: 'registration_open' });
    const userId = await addParticipant(t.id, 'invited', 4);

    const outcome = await declineInvitation(t.id, userId);

    expect(outcome).toEqual({ ok: true });
    const row = await participation(t.id, userId);
    expect(row?.status).toBe('cancelled');
    expect(row?.seed).toBeNull();
  });

  it('reports not_invited when the participant is not in invited status', async () => {
    const t = await createTournament({ status: 'registration_open' });
    const userId = await addParticipant(t.id, 'confirmed');

    expect(await declineInvitation(t.id, userId)).toEqual({
      ok: false,
      reason: 'not_invited',
    });
  });
});
