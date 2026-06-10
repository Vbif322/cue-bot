import { describe, expect, it } from 'vitest';

import {
  canCancelTournament,
  validateSeeds,
} from '@/services/tournamentService.js';

import { makeParticipant } from '../../helpers/fixtures.js';

describe('validateSeeds', () => {
  it('accepts distinct seeds within range 1..count', () => {
    const participants = [
      makeParticipant('a', 1),
      makeParticipant('b', 2),
      makeParticipant('c', 3),
    ];
    expect(validateSeeds(participants, 8)).toBeNull();
  });

  it('ignores participants without a seed', () => {
    const participants = [
      makeParticipant('a', 1),
      makeParticipant('b', null),
      makeParticipant('c', null),
    ];
    expect(validateSeeds(participants, 8)).toBeNull();
  });

  it('rejects a seed below 1', () => {
    expect(validateSeeds([makeParticipant('a', 0)], 8)).toMatch(/диапазон/);
  });

  it('rejects a seed above count', () => {
    expect(validateSeeds([makeParticipant('a', 9)], 8)).toMatch(/диапазон/);
  });

  it('rejects duplicate seeds', () => {
    const participants = [makeParticipant('a', 2), makeParticipant('b', 2)];
    expect(validateSeeds(participants, 8)).toMatch(/нескольким/);
  });
});

describe('canCancelTournament', () => {
  it('allows cancellation while registration is open or closed', () => {
    expect(canCancelTournament('registration_open')).toBe(true);
    expect(canCancelTournament('registration_closed')).toBe(true);
  });

  it('allows cancellation while in progress', () => {
    expect(canCancelTournament('in_progress')).toBe(true);
  });

  it('forbids cancelling a draft, completed or already-cancelled tournament', () => {
    expect(canCancelTournament('draft')).toBe(false);
    expect(canCancelTournament('completed')).toBe(false);
    expect(canCancelTournament('cancelled')).toBe(false);
  });
});
