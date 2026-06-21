import { describe, expect, it, vi } from 'vitest';

import { createRateLimitMiddleware } from '@/bot/middleware/rateLimit.js';
import { RateLimiter } from '@/lib/rateLimiter.js';
import type { BotContext } from '@/bot/types.js';

function makeCtx(fromId: number | undefined) {
  const reply = vi.fn().mockResolvedValue(undefined);
  const ctx = {
    from: fromId === undefined ? undefined : { id: fromId },
    reply,
  } as unknown as BotContext;
  return { ctx, reply };
}

describe('rateLimitMiddleware', () => {
  it('calls next while under the limit', async () => {
    const limiter = new RateLimiter({ capacity: 2, refillPerSec: 1 });
    const mw = createRateLimitMiddleware(limiter);
    const next = vi.fn().mockResolvedValue(undefined);
    const { ctx, reply } = makeCtx(1);

    await mw(ctx, next);
    await mw(ctx, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(reply).not.toHaveBeenCalled();
  });

  it('drops the update (no next) and warns once when over the limit', async () => {
    const limiter = new RateLimiter({ capacity: 1, refillPerSec: 1 });
    const mw = createRateLimitMiddleware(limiter);
    const next = vi.fn().mockResolvedValue(undefined);
    const { ctx, reply } = makeCtx(1);

    await mw(ctx, next); // allowed
    await mw(ctx, next); // rejected -> warn
    await mw(ctx, next); // rejected -> silent

    expect(next).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledTimes(1);
  });

  it('passes through when ctx.from is undefined', async () => {
    const limiter = new RateLimiter({ capacity: 1, refillPerSec: 1 });
    const mw = createRateLimitMiddleware(limiter);
    const next = vi.fn().mockResolvedValue(undefined);
    const { ctx, reply } = makeCtx(undefined);

    await mw(ctx, next);
    await mw(ctx, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(reply).not.toHaveBeenCalled();
  });

  it('limits per user independently', async () => {
    const limiter = new RateLimiter({ capacity: 1, refillPerSec: 1 });
    const mw = createRateLimitMiddleware(limiter);
    const next = vi.fn().mockResolvedValue(undefined);
    const a = makeCtx(1);
    const b = makeCtx(2);

    await mw(a.ctx, next); // user 1 allowed
    await mw(a.ctx, next); // user 1 rejected
    await mw(b.ctx, next); // user 2 still allowed

    expect(next).toHaveBeenCalledTimes(2);
    expect(a.reply).toHaveBeenCalledTimes(1);
    expect(b.reply).not.toHaveBeenCalled();
  });

  it('swallows reply errors and still drops the update', async () => {
    const limiter = new RateLimiter({ capacity: 1, refillPerSec: 1 });
    const mw = createRateLimitMiddleware(limiter);
    const next = vi.fn().mockResolvedValue(undefined);
    const reply = vi.fn().mockRejectedValue(new Error('blocked'));
    const ctx = { from: { id: 1 }, reply } as unknown as BotContext;

    await mw(ctx, next); // allowed
    await expect(mw(ctx, next)).resolves.toBeUndefined(); // rejected, reply throws

    expect(next).toHaveBeenCalledTimes(1);
  });
});
