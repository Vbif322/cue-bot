import { beforeEach, describe, expect, it } from 'vitest';

import { TournamentCreationStateStore } from '@/bot/wizards/tournamentCreation/tournamentCreation.stateStore.js';

const USER = 123;

describe('TournamentCreationStateStore', () => {
  let store: TournamentCreationStateStore;

  beforeEach(() => {
    store = new TournamentCreationStateStore();
  });

  it('start() initialises a session at the name step', () => {
    const state = store.start(USER);
    expect(state).toEqual({ step: 'name', data: { tables: [] } });
    expect(store.has(USER)).toBe(true);
  });

  it('get() returns undefined for an unknown user', () => {
    expect(store.get(999)).toBeUndefined();
  });

  it('getOrThrow() throws when there is no session', () => {
    expect(() => store.getOrThrow(999)).toThrow('Сессия не найдена');
  });

  it('hasStep() reflects the current step', () => {
    store.start(USER);
    expect(store.hasStep(USER, 'name')).toBe(true);
    expect(store.hasStep(USER, 'venue')).toBe(false);
  });

  it('ensureStep() throws on a step mismatch', () => {
    store.start(USER);
    expect(() => store.ensureStep(USER, 'venue')).toThrow(/Ожидался шаг/);
    expect(store.ensureStep(USER, 'name').step).toBe('name');
  });

  it('setStep() transitions immutably (does not mutate the prior object)', () => {
    const before = store.start(USER);
    const after = store.setStep(USER, 'venue');
    expect(after.step).toBe('venue');
    expect(before.step).toBe('name'); // previous snapshot untouched
    expect(after).not.toBe(before);
  });

  it('updateData() deep-merges venue and tournament, replaces tables', () => {
    store.start(USER);
    store.updateData(USER, { tournament: { name: 'Cup' } });
    store.updateData(USER, {
      tournament: { winScore: 3 },
      tables: [{ id: 't1', name: 'Table 1' }],
    });
    const state = store.getOrThrow(USER);
    expect(state.data.tournament).toMatchObject({ name: 'Cup', winScore: 3 });
    expect(state.data.tables).toEqual([{ id: 't1', name: 'Table 1' }]);
  });

  it('update() applies both step and data in one call', () => {
    store.start(USER);
    const state = store.update(USER, {
      step: 'venue',
      data: { venue: { id: 'v1', name: 'Hall' } },
    });
    expect(state.step).toBe('venue');
    expect(state.data.venue).toEqual({ id: 'v1', name: 'Hall' });
  });

  it('clear() removes the session', () => {
    store.start(USER);
    expect(store.clear(USER)).toBe(true);
    expect(store.has(USER)).toBe(false);
    expect(store.clear(USER)).toBe(false); // already gone
  });
});
