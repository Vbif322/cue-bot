import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UUID } from 'crypto';

import {
  REFRESH_DEBOUNCE_MS,
  markAnnouncementStale,
  setAnnouncementRefresher,
} from '@/services/announcementRefresh.js';
import type { RefreshOutcome } from '@/services/announcementRefresh.js';

const T1 = '11111111-1111-4111-8111-111111111111' as UUID;
const T2 = '22222222-2222-4222-8222-222222222222' as UUID;

describe('markAnnouncementStale', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    setAnnouncementRefresher(null);
    vi.useRealTimers();
  });

  it('без подставленной правки — no-op', async () => {
    markAnnouncementStale(T1);

    expect(vi.getTimerCount()).toBe(0);
    await vi.runAllTimersAsync();
  });

  it('склеивает пачку сигналов в одну правку', async () => {
    const refresher = vi.fn().mockResolvedValue({});
    setAnnouncementRefresher(refresher);

    markAnnouncementStale(T1);
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS - 1);
    markAnnouncementStale(T1);
    markAnnouncementStale(T1);
    expect(refresher).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);

    expect(refresher).toHaveBeenCalledTimes(1);
    expect(refresher).toHaveBeenCalledWith(T1);
  });

  it('разные турниры не склеиваются', async () => {
    const refresher = vi.fn().mockResolvedValue({});
    setAnnouncementRefresher(refresher);

    markAnnouncementStale(T1);
    markAnnouncementStale(T2);
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);

    expect(refresher).toHaveBeenCalledTimes(2);
  });

  it('сигнал во время правки даёт ровно один повторный проход после неё', async () => {
    let finish: (value: RefreshOutcome) => void = () => undefined;
    const refresher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<RefreshOutcome>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue({});
    setAnnouncementRefresher(refresher);

    markAnnouncementStale(T1);
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    expect(refresher).toHaveBeenCalledTimes(1);

    // Правка ещё идёт: новые сигналы не запускают параллельный проход.
    markAnnouncementStale(T1);
    markAnnouncementStale(T1);
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS * 3);
    expect(refresher).toHaveBeenCalledTimes(1);

    finish({});
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    expect(refresher).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS * 3);
    expect(refresher).toHaveBeenCalledTimes(2);
  });

  it('429 — повтор не раньше retry_after', async () => {
    const refresher = vi
      .fn()
      .mockResolvedValueOnce({ retryAfterSec: 30 })
      .mockResolvedValue({});
    setAnnouncementRefresher(refresher);

    markAnnouncementStale(T1);
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    expect(refresher).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(29_000);
    expect(refresher).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(refresher).toHaveBeenCalledTimes(2);
  });

  it('брошенная правкой ошибка не залипает турнир', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const refresher = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({});
    setAnnouncementRefresher(refresher);

    markAnnouncementStale(T1);
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);
    markAnnouncementStale(T1);
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS);

    expect(refresher).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('снятие правки гасит отложенные таймеры', async () => {
    const refresher = vi.fn().mockResolvedValue({});
    setAnnouncementRefresher(refresher);

    markAnnouncementStale(T1);
    setAnnouncementRefresher(null);
    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS * 2);

    expect(refresher).not.toHaveBeenCalled();
  });
});
