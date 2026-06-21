import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/db.js';
import { dialogSessions } from '@/db/schema.js';
import {
  PgSessionStore,
  sweepExpiredDialogSessions,
} from '@/services/dialogSessionStore.js';
import { TournamentCreationStateStore } from '@/bot/wizards/tournamentCreation/tournamentCreation.stateStore.js';

import { truncateAll } from '../helpers/truncate.js';

const USER = 123;

/** Force a session's expiry to a fixed instant for TTL/sweep assertions. */
async function setExpiry(
  namespace: string,
  key: string | number,
  expiresAt: Date,
): Promise<void> {
  await db
    .update(dialogSessions)
    .set({ expiresAt })
    .where(
      and(
        eq(dialogSessions.namespace, namespace),
        eq(dialogSessions.key, String(key)),
      ),
    );
}

describe('PgSessionStore', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('set/get/has/delete round-trip', async () => {
    const store = new PgSessionStore<{ value: number }>('test-ns');

    expect(await store.get(USER)).toBeUndefined();
    expect(await store.has(USER)).toBe(false);

    await store.set(USER, { value: 42 });
    expect(await store.get(USER)).toEqual({ value: 42 });
    expect(await store.has(USER)).toBe(true);

    expect(await store.delete(USER)).toBe(true);
    expect(await store.has(USER)).toBe(false);
    expect(await store.delete(USER)).toBe(false); // already gone
  });

  it('set upserts (overwrites) the same key', async () => {
    const store = new PgSessionStore<{ value: number }>('test-ns');

    await store.set(USER, { value: 1 });
    await store.set(USER, { value: 2 });

    expect(await store.get(USER)).toEqual({ value: 2 });
  });

  it('namespaces are isolated', async () => {
    const a = new PgSessionStore<{ v: string }>('ns-a');
    const b = new PgSessionStore<{ v: string }>('ns-b');

    await a.set(USER, { v: 'a' });
    expect(await b.get(USER)).toBeUndefined();
  });

  it('ignores expired sessions on read', async () => {
    const store = new PgSessionStore<{ value: number }>('test-ns');

    await store.set(USER, { value: 7 });
    await setExpiry('test-ns', USER, new Date(Date.now() - 1000));

    expect(await store.get(USER)).toBeUndefined();
    expect(await store.has(USER)).toBe(false);
  });

  it('sweep deletes only expired rows', async () => {
    const store = new PgSessionStore<{ value: number }>('test-ns');

    await store.set(1, { value: 1 });
    await store.set(2, { value: 2 });
    await setExpiry('test-ns', 1, new Date(Date.now() - 1000));

    const removed = await sweepExpiredDialogSessions();
    expect(removed).toBe(1);

    expect(await store.get(1)).toBeUndefined();
    expect(await store.get(2)).toEqual({ value: 2 });
  });
});

describe('TournamentCreationStateStore (persistence)', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('persists state across store instances and restores Date types', async () => {
    const startDate = new Date('2026-06-21T18:30:00.000Z');

    const store = new TournamentCreationStateStore();
    await store.start(USER);
    await store.update(USER, {
      step: 'visibility',
      data: { tournament: { name: 'Cup', startDate } },
    });

    // A fresh instance simulates a process restart — state must survive.
    const restored = new TournamentCreationStateStore();
    const state = await restored.getOrThrow(USER);

    expect(state.step).toBe('visibility');
    expect(state.data.tournament?.name).toBe('Cup');
    // startDate round-trips through jsonb as a string; the store re-hydrates it.
    expect(state.data.tournament?.startDate).toBeInstanceOf(Date);
    expect(state.data.tournament?.startDate?.toISOString()).toBe(
      startDate.toISOString(),
    );
  });

  it('clear removes the session', async () => {
    const store = new TournamentCreationStateStore();
    await store.start(USER);

    expect(await store.has(USER)).toBe(true);
    expect(await store.clear(USER)).toBe(true);
    expect(await store.has(USER)).toBe(false);
  });
});
