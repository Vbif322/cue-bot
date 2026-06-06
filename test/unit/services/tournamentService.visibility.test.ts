import { describe, expect, it } from 'vitest';

import { isTournamentVisibleTo } from '@/services/tournamentService.js';
import type { TournamentViewer } from '@/services/tournamentService.js';

const noAccess: TournamentViewer = {
  isAdmin: false,
  isReferee: false,
  isParticipant: false,
  isCreator: false,
};

describe('isTournamentVisibleTo', () => {
  it('public tournaments are visible to anyone, even with no roles', () => {
    expect(isTournamentVisibleTo({ visibility: 'public' }, noAccess)).toBe(true);
  });

  it('private tournaments are hidden from users with no relationship', () => {
    expect(isTournamentVisibleTo({ visibility: 'private' }, noAccess)).toBe(
      false,
    );
  });

  it.each([
    ['admin', { ...noAccess, isAdmin: true }],
    ['referee', { ...noAccess, isReferee: true }],
    ['participant', { ...noAccess, isParticipant: true }],
    ['creator', { ...noAccess, isCreator: true }],
  ] as const)('private tournaments are visible to %s', (_label, viewer) => {
    expect(isTournamentVisibleTo({ visibility: 'private' }, viewer)).toBe(true);
  });
});
