import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/db.js';
import { federationMembers } from '@/db/schema.js';
import {
  addMember,
  assertFederationActive,
  createFederation,
  deleteFederation,
  FEDERATION_GRANT_REQUIRED_ERROR,
  getFederationActiveUntil,
  getMembership,
  getUserFederations,
  isStaffUser,
  removeMember,
  setMemberRole,
  setOrganizerUntil,
  MAX_OWNED_FEDERATIONS_PER_USER,
} from '@/services/federationService.js';
import {
  canAdministerTournamentAsUser,
  canManageTournamentAsUser,
  getActorScope,
} from '@/services/authz.js';
import { getMatchDecisionMakers } from '@/services/refereeService.js';
import { mergeAccountIntoTelegram } from '@/services/userService.js';

import {
  createFederation as seedFederation,
  createOrganizer,
  createTournament,
  createUser,
  grantUntil,
} from '../helpers/factories.js';
import { truncateAll } from '../helpers/truncate.js';

describe('federationService', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('createFederation normalises the city and makes the creator its owner', async () => {
    const owner = await createUser();
    const fed = await createFederation({
      name: '  Лига   снукера ',
      city: ' казань ',
      ownerId: owner.id,
    });
    expect(fed.name).toBe('Лига снукера');
    expect(fed.city).toBe('Казань');
    expect(await getMembership(owner.id, fed.id)).toBe('owner');
    expect(await getUserFederations(owner.id)).toEqual([
      {
        id: fed.id,
        name: 'Лига снукера',
        city: 'Казань',
        role: 'owner',
        activeUntil: null,
      },
    ]);
    expect(await isStaffUser(owner)).toBe(true);
  });

  it('createFederation rejects empty name / city', async () => {
    const owner = await createUser();
    await expect(
      createFederation({ name: ' ', city: 'Москва', ownerId: owner.id }),
    ).rejects.toThrow('Укажите название');
    await expect(
      createFederation({ name: 'X', city: '  ', ownerId: owner.id }),
    ).rejects.toThrow('Укажите город');
  });

  it('self-service requires an active organizer grant', async () => {
    const owner = await createUser();
    const input = { name: 'Лига', city: 'Москва', ownerId: owner.id };
    await expect(
      createFederation({ ...input, selfService: true }),
    ).rejects.toThrow(FEDERATION_GRANT_REQUIRED_ERROR);

    await setOrganizerUntil(owner.id, new Date(Date.now() - 1000));
    await expect(
      createFederation({ ...input, selfService: true }),
    ).rejects.toThrow(FEDERATION_GRANT_REQUIRED_ERROR);

    await setOrganizerUntil(owner.id, grantUntil());
    await expect(
      createFederation({ ...input, selfService: true }),
    ).resolves.toBeDefined();
  });

  it('self-service owner limit applies only when enforced', async () => {
    const owner = await createUser({ organizerUntil: grantUntil() });
    for (let i = 0; i < MAX_OWNED_FEDERATIONS_PER_USER; i++) {
      await createFederation({
        name: `F${String(i)}`,
        city: 'Москва',
        ownerId: owner.id,
        selfService: true,
      });
    }
    await expect(
      createFederation({
        name: 'one more',
        city: 'Москва',
        ownerId: owner.id,
        selfService: true,
      }),
    ).rejects.toThrow(/Нельзя владеть/);
    // платформенный админ лимит не применяет
    await expect(
      createFederation({ name: 'by admin', city: 'Москва', ownerId: owner.id }),
    ).resolves.toBeDefined();
  });

  it('activeUntil is the latest owner grant; organizers do not count', async () => {
    const fed = await seedFederation({ active: false });
    expect(await getFederationActiveUntil(fed.id)).toBeNull();
    await expect(assertFederationActive(fed.id)).rejects.toThrow(/истёк/);

    // грант организатора (не владельца) федерацию не открывает
    await createOrganizer(fed.id, 'organizer', {
      organizerUntil: grantUntil(),
    });
    expect(await getFederationActiveUntil(fed.id)).toBeNull();

    const soon = grantUntil(10);
    const later = grantUntil(100);
    await setOrganizerUntil(fed.ownerId, soon);
    await createOrganizer(fed.id, 'owner', { organizerUntil: later });
    expect((await getFederationActiveUntil(fed.id))?.getTime()).toBe(
      later.getTime(),
    );
    await expect(assertFederationActive(fed.id)).resolves.toBeUndefined();
    expect((await getUserFederations(fed.ownerId))[0]?.activeUntil).toEqual(
      later,
    );
  });

  it('a lapsed grant keeps members staff but closes new tournaments', async () => {
    const fed = await seedFederation();
    await setOrganizerUntil(fed.ownerId, new Date(Date.now() - 1000));
    await expect(assertFederationActive(fed.id)).rejects.toThrow(/истёк/);
    const owner = await db.query.users.findFirst({
      where: (u, { eq }) => eq(u.id, fed.ownerId),
    });
    if (!owner) throw new Error('owner missing');
    expect(await isStaffUser(owner)).toBe(true);
  });

  it('an active grant alone makes the user staff', async () => {
    const user = await createUser({ organizerUntil: grantUntil() });
    expect(await isStaffUser(user)).toBe(true);
    const lapsed = await createUser({
      organizerUntil: new Date(Date.now() - 1000),
    });
    expect(await isStaffUser(lapsed)).toBe(false);
  });

  it('last-owner guard: cannot demote or remove the only owner', async () => {
    const fed = await seedFederation();
    await expect(
      setMemberRole(fed.id, fed.ownerId, 'organizer'),
    ).rejects.toThrow('Нельзя снять последнего владельца');
    await expect(removeMember(fed.id, fed.ownerId)).rejects.toThrow(
      'Нельзя снять последнего владельца',
    );

    const second = await createUser();
    expect(await addMember(fed.id, second.id, 'owner')).toEqual({ ok: true });
    expect(await addMember(fed.id, second.id, 'owner')).toEqual({
      ok: false,
      reason: 'already_member',
    });
    // теперь владельцев двое — первого можно понизить и удалить
    await setMemberRole(fed.id, fed.ownerId, 'organizer');
    expect(await getMembership(fed.ownerId, fed.id)).toBe('organizer');
    await removeMember(fed.id, fed.ownerId);
    expect(await getMembership(fed.ownerId, fed.id)).toBeNull();
  });

  it('deleteFederation refuses while tournaments reference it', async () => {
    const fed = await seedFederation();
    await createTournament({ federationId: fed.id });
    expect(await deleteFederation(fed.id)).toBe('has_references');
    const empty = await seedFederation();
    expect(await deleteFederation(empty.id)).toBe('deleted');
    expect(await deleteFederation(empty.id)).toBe('not_found');
  });

  it('authz: organizer administers own federation tournaments only; referee only manages', async () => {
    const fed = await seedFederation();
    const other = await seedFederation();
    const organizer = await createOrganizer(fed.id);
    const stranger = await createUser();
    const admin = await createUser({ role: 'admin' });

    const own = await createTournament({ federationId: fed.id });
    const foreign = await createTournament({ federationId: other.id });
    const platform = await createTournament();

    expect(await canAdministerTournamentAsUser(organizer, own.id)).toBe(true);
    expect(await canManageTournamentAsUser(organizer, own.id)).toBe(true);
    expect(await canAdministerTournamentAsUser(organizer, foreign.id)).toBe(
      false,
    );
    expect(await canAdministerTournamentAsUser(organizer, platform.id)).toBe(
      false,
    );
    expect(await canAdministerTournamentAsUser(stranger, own.id)).toBe(false);
    expect(await canAdministerTournamentAsUser(admin, platform.id)).toBe(true);
    expect(await canAdministerTournamentAsUser(admin, foreign.id)).toBe(true);

    expect(await getActorScope(admin)).toEqual({ kind: 'all' });
    expect(await getActorScope(organizer)).toEqual({
      kind: 'federations',
      ids: [fed.id],
    });
    expect(await getActorScope(stranger)).toEqual({
      kind: 'federations',
      ids: [],
    });
  });

  it('getMatchDecisionMakers falls back to federation members before createdBy', async () => {
    const fed = await seedFederation();
    const organizer = await createOrganizer(fed.id);
    const creator = await createUser();
    const t = await createTournament({
      federationId: fed.id,
      createdBy: creator.id,
    });
    const makers = await getMatchDecisionMakers(t.id);
    expect(makers.byReferees).toBe(false);
    expect(new Set(makers.userIds)).toEqual(
      new Set([fed.ownerId, organizer.id]),
    );

    const platform = await createTournament({ createdBy: creator.id });
    expect(await getMatchDecisionMakers(platform.id)).toEqual({
      userIds: [creator.id],
      byReferees: false,
    });
  });

  it('merging accounts carries memberships over, keeping the senior role', async () => {
    const fedA = await seedFederation();
    const fedB = await seedFederation();
    const survivor = await createUser({ telegram_id: '777001' });
    const losing = await createUser({
      telegram_id: null,
      email: 'l@example.com',
    });
    await db.insert(federationMembers).values([
      { federationId: fedA.id, userId: losing.id, role: 'owner' },
      { federationId: fedB.id, userId: losing.id, role: 'organizer' },
      { federationId: fedB.id, userId: survivor.id, role: 'owner' },
    ]);

    await mergeAccountIntoTelegram(survivor.id, losing.id);

    expect(await getMembership(survivor.id, fedA.id)).toBe('owner');
    expect(await getMembership(survivor.id, fedB.id)).toBe('owner');
    expect(await getMembership(losing.id, fedA.id)).toBeNull();
    expect(await getMembership(losing.id, fedB.id)).toBeNull();
  });

  it('merging accounts keeps the longer organizer grant', async () => {
    const shorter = grantUntil(10);
    const longer = grantUntil(100);
    const survivor = await createUser({
      telegram_id: '777002',
      organizerUntil: shorter,
    });
    const losing = await createUser({
      telegram_id: null,
      email: 'g@example.com',
      organizerUntil: longer,
    });
    const merged = await mergeAccountIntoTelegram(survivor.id, losing.id);
    expect(merged.organizerUntil).toEqual(longer);
  });
});
