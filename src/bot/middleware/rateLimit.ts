import type { NextFunction } from 'grammy';

import { RateLimiter } from '@/lib/rateLimiter.js';

import type { BotContext } from '../types.js';

// Generic per-user flood protection. Runs BEFORE authMiddleware so a flood is
// dropped before it triggers the per-update user upsert (a Postgres transaction).
// capacity 10 / 1 per second: invisible to real users tapping through wizards,
// but throttles scripted spam to a trickle.
export const FLOOD_CAPACITY = 10;
export const FLOOD_REFILL_PER_SEC = 1;

const FLOOD_MESSAGE = 'Слишком много сообщений. Подождите немного.';

export const botFloodLimiter = new RateLimiter({
  capacity: FLOOD_CAPACITY,
  refillPerSec: FLOOD_REFILL_PER_SEC,
});

/**
 * Build the flood-protection middleware. The limiter is injectable so unit tests
 * can drive it with a fake clock without touching the module-level singleton.
 */
export function createRateLimitMiddleware(limiter: RateLimiter = botFloodLimiter) {
  return async function rateLimitMiddleware(
    ctx: BotContext,
    next: NextFunction,
  ): Promise<void> {
    const fromId = ctx.from?.id;
    if (fromId === undefined) {
      return next();
    }

    const { allowed, firstReject } = limiter.hit(fromId);
    if (allowed) {
      return next();
    }

    // Warn once per rejection streak, then stay silent so the flood is not
    // mirrored back as a flood of replies. Never call next(): the update is dropped.
    if (firstReject) {
      try {
        await ctx.reply(FLOOD_MESSAGE);
      } catch {
        // Replying can fail (user blocked the bot, network) — ignore; the point
        // is to drop the update, not to guarantee delivery of the warning.
      }
    }
  };
}

export const rateLimitMiddleware = createRateLimitMiddleware();
