import { describe, expect, it } from 'vitest';

import {
  canCancelTournament,
  canTransitionTournamentStatus,
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

describe('canTransitionTournamentStatus', () => {
  it('allows the documented forward transitions', () => {
    expect(canTransitionTournamentStatus('draft', 'registration_open')).toBe(true);
    expect(
      canTransitionTournamentStatus('registration_open', 'registration_closed'),
    ).toBe(true);
    expect(
      canTransitionTournamentStatus('registration_closed', 'in_progress'),
    ).toBe(true);
    expect(canTransitionTournamentStatus('in_progress', 'completed')).toBe(true);
  });

  it('allows cancelling from any active status', () => {
    expect(canTransitionTournamentStatus('draft', 'cancelled')).toBe(true);
    expect(canTransitionTournamentStatus('registration_open', 'cancelled')).toBe(true);
    expect(canTransitionTournamentStatus('registration_closed', 'cancelled')).toBe(true);
    expect(canTransitionTournamentStatus('in_progress', 'cancelled')).toBe(true);
  });

  it('forbids rollbacks', () => {
    expect(canTransitionTournamentStatus('completed', 'draft')).toBe(false);
    expect(
      canTransitionTournamentStatus('in_progress', 'registration_open'),
    ).toBe(false);
    expect(
      canTransitionTournamentStatus('registration_closed', 'registration_open'),
    ).toBe(false);
  });

  it('forbids skipping over intermediate states', () => {
    expect(canTransitionTournamentStatus('draft', 'in_progress')).toBe(false);
    expect(canTransitionTournamentStatus('registration_open', 'in_progress')).toBe(false);
  });

  it('forbids self-transitions and exits from terminal states', () => {
    expect(canTransitionTournamentStatus('draft', 'draft')).toBe(false);
    expect(canTransitionTournamentStatus('completed', 'cancelled')).toBe(false);
    expect(canTransitionTournamentStatus('cancelled', 'draft')).toBe(false);
  });
});
