import { describe, expect, it } from 'vitest';

import {
  canAdministerTournamentWith,
  canCreateFederationWith,
  canManageFederation,
  canManageTournamentWith,
  canOrganizeIn,
  hasOrganizerGrant,
  isFederationActive,
  isPlatformAdmin,
  isStaff,
  scopeIncludes,
  type GrantedActor,
} from '@/services/authz.js';

const id = (n: number) =>
  `00000000-0000-0000-0000-00000000000${String(n)}` as const;

const NOW = new Date('2026-06-01T12:00:00Z');
const FUTURE = new Date('2026-07-01T00:00:00Z');
const PAST = new Date('2026-05-01T00:00:00Z');

const admin: GrantedActor = { id: id(1), role: 'admin', organizerUntil: null };
const user: GrantedActor = { id: id(2), role: 'user', organizerUntil: null };
const granted: GrantedActor = { ...user, organizerUntil: FUTURE };
const lapsed: GrantedActor = { ...user, organizerUntil: PAST };

describe('authz predicates', () => {
  it('isPlatformAdmin follows users.role', () => {
    expect(isPlatformAdmin(admin)).toBe(true);
    expect(isPlatformAdmin(user)).toBe(false);
  });

  it('isStaff: admin, active grant, or at least one federation', () => {
    expect(isStaff(admin, 0, NOW)).toBe(true);
    expect(isStaff(user, 0, NOW)).toBe(false);
    expect(isStaff(user, 1, NOW)).toBe(true);
    expect(isStaff(granted, 0, NOW)).toBe(true);
    expect(isStaff(lapsed, 0, NOW)).toBe(false);
    // истёкший срок не выгоняет из панели члена федерации — доиграть турниры
    expect(isStaff(lapsed, 1, NOW)).toBe(true);
  });

  it('hasOrganizerGrant: only a future organizerUntil', () => {
    expect(hasOrganizerGrant(user, NOW)).toBe(false);
    expect(hasOrganizerGrant(granted, NOW)).toBe(true);
    expect(hasOrganizerGrant(lapsed, NOW)).toBe(false);
    expect(hasOrganizerGrant({ organizerUntil: NOW }, NOW)).toBe(false);
  });

  it('canCreateFederationWith: admin or active grant', () => {
    expect(canCreateFederationWith(admin, NOW)).toBe(true);
    expect(canCreateFederationWith(granted, NOW)).toBe(true);
    expect(canCreateFederationWith(lapsed, NOW)).toBe(false);
    expect(canCreateFederationWith(user, NOW)).toBe(false);
  });

  it('isFederationActive: owners term in the future', () => {
    expect(isFederationActive(null, NOW)).toBe(false);
    expect(isFederationActive(PAST, NOW)).toBe(false);
    expect(isFederationActive(FUTURE, NOW)).toBe(true);
  });

  it('canManageFederation: admin or owner, not organizer', () => {
    expect(canManageFederation(admin, null)).toBe(true);
    expect(canManageFederation(user, 'owner')).toBe(true);
    expect(canManageFederation(user, 'organizer')).toBe(false);
    expect(canManageFederation(user, null)).toBe(false);
  });

  it('canOrganizeIn: admin or any member', () => {
    expect(canOrganizeIn(admin, null)).toBe(true);
    expect(canOrganizeIn(user, 'organizer')).toBe(true);
    expect(canOrganizeIn(user, 'owner')).toBe(true);
    expect(canOrganizeIn(user, null)).toBe(false);
  });

  it('administer: federation member or admin — a referee is NOT enough', () => {
    expect(
      canAdministerTournamentWith(user, { membership: null, isReferee: true }),
    ).toBe(false);
    expect(
      canAdministerTournamentWith(user, {
        membership: 'organizer',
        isReferee: false,
      }),
    ).toBe(true);
    expect(
      canAdministerTournamentWith(admin, {
        membership: null,
        isReferee: false,
      }),
    ).toBe(true);
    expect(
      canAdministerTournamentWith(user, { membership: null, isReferee: false }),
    ).toBe(false);
  });

  it('manage: administer OR referee', () => {
    expect(
      canManageTournamentWith(user, { membership: null, isReferee: true }),
    ).toBe(true);
    expect(
      canManageTournamentWith(user, { membership: 'owner', isReferee: false }),
    ).toBe(true);
    expect(
      canManageTournamentWith(user, { membership: null, isReferee: false }),
    ).toBe(false);
  });

  it('scopeIncludes: `all` matches everything incl. platform (null); federations never match null', () => {
    expect(scopeIncludes({ kind: 'all' }, null)).toBe(true);
    expect(scopeIncludes({ kind: 'all' }, id(5))).toBe(true);
    expect(scopeIncludes({ kind: 'federations', ids: [id(5)] }, null)).toBe(
      false,
    );
    expect(scopeIncludes({ kind: 'federations', ids: [id(5)] }, id(5))).toBe(
      true,
    );
    expect(scopeIncludes({ kind: 'federations', ids: [id(5)] }, id(6))).toBe(
      false,
    );
    expect(scopeIncludes({ kind: 'federations', ids: [] }, id(5))).toBe(false);
  });
});
