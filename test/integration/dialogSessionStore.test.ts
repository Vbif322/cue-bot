import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/db.js';
import { dialogSessions } from '@/db/schema.js';
import {
  PgSessionStore,
  findActiveDialogSession,
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

describe('PgSessionStore exclusive sessions (claim / replace)', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  const SCOPE = ['ns-a', 'ns-b', 'ns-c'];

  it('claim displaces the key in other scoped namespaces only', async () => {
    const a = new PgSessionStore<{ v: string }>('ns-a');
    const b = new PgSessionStore<{ v: string }>('ns-b');
    const outside = new PgSessionStore<{ v: string }>('ns-outside');

    await b.set(USER, { v: 'b' });
    await b.set(999, { v: 'other user' });
    await outside.set(USER, { v: 'outside' });

    const displaced = await a.claim(USER, { v: 'a' }, SCOPE);

    expect(displaced).toEqual([{ namespace: 'ns-b', data: { v: 'b' } }]);
    expect(await a.get(USER)).toEqual({ v: 'a' });
    expect(await b.get(USER)).toBeUndefined();
    expect(await b.get(999)).toEqual({ v: 'other user' });
    expect(await outside.get(USER)).toEqual({ v: 'outside' });
  });

  it('claim does not report expired displaced sessions', async () => {
    const a = new PgSessionStore<{ v: string }>('ns-a');
    const b = new PgSessionStore<{ v: string }>('ns-b');

    await b.set(USER, { v: 'stale' });
    await setExpiry('ns-b', USER, new Date(Date.now() - 1000));

    expect(await a.claim(USER, { v: 'a' }, SCOPE)).toEqual([]);
    expect(await b.get(USER)).toBeUndefined();
  });

  it('claim on its own namespace overwrites and displaces nothing', async () => {
    const a = new PgSessionStore<{ v: string }>('ns-a');

    await a.claim(USER, { v: '1' }, SCOPE);
    expect(await a.claim(USER, { v: '2' }, SCOPE)).toEqual([]);
    expect(await a.get(USER)).toEqual({ v: '2' });
  });

  it('concurrent claims leave exactly one session for the key', async () => {
    const stores = SCOPE.map((ns) => new PgSessionStore<{ v: string }>(ns));

    await Promise.all(
      stores.map((store) => store.claim(USER, { v: store.namespace }, SCOPE)),
    );

    const rows = await db.query.dialogSessions.findMany({
      where: eq(dialogSessions.key, String(USER)),
    });
    expect(rows).toHaveLength(1);
  });

  it('replace updates an active session but never re-inserts', async () => {
    const a = new PgSessionStore<{ v: string }>('ns-a');
    const b = new PgSessionStore<{ v: string }>('ns-b');

    expect(await a.replace(USER, { v: 'x' })).toBe(false);
    expect(await a.get(USER)).toBeUndefined();

    await a.claim(USER, { v: '1' }, SCOPE);
    expect(await a.replace(USER, { v: '2' })).toBe(true);
    expect(await a.get(USER)).toEqual({ v: '2' });

    // Another flow took over — a late write of the old flow must not revive it.
    await b.claim(USER, { v: 'b' }, SCOPE);
    expect(await a.replace(USER, { v: '3' })).toBe(false);
    expect(await a.get(USER)).toBeUndefined();
  });

  it('replace does not revive an expired session', async () => {
    const a = new PgSessionStore<{ v: string }>('ns-a');

    await a.set(USER, { v: '1' });
    await setExpiry('ns-a', USER, new Date(Date.now() - 1000));

    expect(await a.replace(USER, { v: '2' })).toBe(false);
    expect(await a.get(USER)).toBeUndefined();
  });

  it('findActiveDialogSession returns the active session among namespaces', async () => {
    const a = new PgSessionStore<{ v: string }>('ns-a');
    const b = new PgSessionStore<{ v: string }>('ns-b');

    expect(await findActiveDialogSession(USER, SCOPE)).toBeUndefined();

    await a.set(USER, { v: 'a' });
    expect(await findActiveDialogSession(USER, SCOPE)).toEqual({
      namespace: 'ns-a',
      data: { v: 'a' },
    });
    expect(await findActiveDialogSession(USER, ['ns-b'])).toBeUndefined();
    expect(await findActiveDialogSession(USER, [])).toBeUndefined();

    await b.set(USER, { v: 'b' });
    await setExpiry('ns-b', USER, new Date(Date.now() - 1000));
    expect((await findActiveDialogSession(USER, SCOPE))?.namespace).toBe(
      'ns-a',
    );
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

  it('updates fail once the session is gone (never revived)', async () => {
    const store = new TournamentCreationStateStore();
    await store.start(USER);
    await store.clear(USER);

    await expect(store.setStep(USER, 'date')).rejects.toThrow(
      'Сессия не найдена',
    );
    expect(await store.has(USER)).toBe(false);
  });

  it('clear removes the session', async () => {
    const store = new TournamentCreationStateStore();
    await store.start(USER);

    expect(await store.has(USER)).toBe(true);
    expect(await store.clear(USER)).toBe(true);
    expect(await store.has(USER)).toBe(false);
  });
});
