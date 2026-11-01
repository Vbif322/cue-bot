import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  endTextSession,
  getActiveTextSession,
  registerTextSession,
} from '@/bot/sessions/textSessionRegistry.js';
import { TextSessionStore } from '@/bot/sessions/textSessionStore.js';
import type { BotContext } from '@/bot/types.js';

import { truncateAll } from '../helpers/truncate.js';

const USER = 321;
const ctx = {} as BotContext;

// Модульный реестр изолирован на файл (vitest), так что тестовые сессии не
// пересекаются с регистрациями бота.
const wizardStore = new TextSessionStore<{ step: string }>('test-wizard');
const softStore = new TextSessionStore<{ matchId: string }>('test-soft', {
  hydrate: (raw) => ({ ...(raw as { matchId: string }) }),
});
const wizardEnd = vi.fn().mockResolvedValue(undefined);
const softEnd = vi.fn().mockResolvedValue(undefined);

registerTextSession({
  store: wizardStore,
  name: 'тестовый wizard',
  blocking: true,
  callbackPrefix: 'tw:',
  cancelReply: 'Wizard отменён.',
  onText: vi.fn(),
  onEnd: wizardEnd,
});

registerTextSession({
  store: softStore,
  name: 'тестовая мягкая сессия',
  blocking: false,
  cancelReply: 'Отменено.',
  onText: vi.fn(),
  onEnd: softEnd,
});

describe('text sessions: one active session per user', () => {
  beforeEach(async () => {
    await truncateAll();
    vi.clearAllMocks();
  });

  it('rejects a duplicate namespace', () => {
    expect(() => {
      registerTextSession({
        store: new TextSessionStore('test-soft'),
        name: 'дубль',
        blocking: false,
        cancelReply: '',
        onText: vi.fn(),
      });
    }).toThrow();
  });

  it('starting a session supersedes the other one and calls its onEnd', async () => {
    await softStore.start(USER, { matchId: 'm1' }, ctx);
    expect((await getActiveTextSession(USER))?.session.namespace).toBe(
      'test-soft',
    );

    await wizardStore.start(USER, { step: 'name' }, ctx);

    expect(await softStore.get(USER)).toBeUndefined();
    expect(softEnd).toHaveBeenCalledWith(ctx, { matchId: 'm1' }, 'superseded');
    expect(wizardEnd).not.toHaveBeenCalled();

    const active = await getActiveTextSession(USER);
    expect(active?.session.namespace).toBe('test-wizard');
    expect(active?.data).toEqual({ step: 'name' });
  });

  it('without ctx the displaced session ends silently', async () => {
    await softStore.start(USER, { matchId: 'm1' });
    await wizardStore.start(USER, { step: 'name' });

    expect(await softStore.get(USER)).toBeUndefined();
    expect(softEnd).not.toHaveBeenCalled();
  });

  it('a superseded session cannot be updated back to life', async () => {
    await softStore.start(USER, { matchId: 'm1' });
    await wizardStore.start(USER, { step: 'name' });

    expect(await softStore.update(USER, { matchId: 'm2' })).toBe(false);
    expect((await getActiveTextSession(USER))?.session.namespace).toBe(
      'test-wizard',
    );
  });

  it('endTextSession deletes the row and calls onEnd once', async () => {
    await softStore.start(USER, { matchId: 'm1' });
    const active = await getActiveTextSession(USER);
    if (!active) throw new Error('expected an active session');

    expect(await endTextSession(ctx, USER, active, 'cancel')).toBe(true);
    expect(softEnd).toHaveBeenCalledWith(ctx, { matchId: 'm1' }, 'cancel');
    expect(await getActiveTextSession(USER)).toBeUndefined();

    // Already ended (e.g. a concurrent /cancel) — no second onEnd.
    expect(await endTextSession(ctx, USER, active, 'cancel')).toBe(false);
    expect(softEnd).toHaveBeenCalledTimes(1);
  });

  it('a failing onEnd does not break the new session', async () => {
    softEnd.mockRejectedValueOnce(new Error('telegram down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await softStore.start(USER, { matchId: 'm1' });
    await wizardStore.start(USER, { step: 'name' }, ctx);

    expect(await wizardStore.get(USER)).toEqual({ step: 'name' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
