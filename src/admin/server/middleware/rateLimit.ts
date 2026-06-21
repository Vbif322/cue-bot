import type { Context, MiddlewareHandler } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';

import { RateLimiter } from '@/lib/rateLimiter.js';

export interface IpRateLimitOptions {
  capacity: number;
  refillPerSec: number;
  /**
   * Number of trusted reverse proxies in front of the app (default 1 = nginx).
   * The client IP is read as the Nth-from-the-right entry of X-Forwarded-For, so
   * a client-supplied (left-most) XFF entry cannot be used to dodge the limit.
   */
  trustedProxies?: number;
  /** Injectable for tests; defaults to a fresh internal limiter. */
  limiter?: RateLimiter;
  /** Response when the limit is exceeded. Defaults to a bare 429. */
  onLimit?: (c: Context) => Response | Promise<Response>;
}

/**
 * Resolve the client IP, resistant to X-Forwarded-For spoofing.
 *
 * With `trustedProxies` proxies appending to XFF, the right-most `trustedProxies`
 * entries are set by our own infrastructure; the genuine client IP is the entry at
 * `length - trustedProxies`. Anything further left is attacker-controlled and ignored.
 * Falls back to the raw connection IP when no XFF is present (e.g. local dev).
 */
export function resolveClientIp(c: Context, trustedProxies: number): string {
  const xff = c.req.header('x-forwarded-for');
  if (xff && trustedProxies > 0) {
    const parts = xff
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    const ip = parts[Math.max(0, parts.length - trustedProxies)];
    if (ip) return ip;
  }

  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Per-IP rate limiter as a Hono middleware. */
export function createIpRateLimit(opts: IpRateLimitOptions): MiddlewareHandler {
  const trustedProxies = opts.trustedProxies ?? 1;
  const limiter =
    opts.limiter ??
    new RateLimiter({
      capacity: opts.capacity,
      refillPerSec: opts.refillPerSec,
    });
  const onLimit =
    opts.onLimit ?? ((c: Context) => c.json({ error: 'Too many requests' }, 429));

  return async function ipRateLimit(c, next) {
    const ip = resolveClientIp(c, trustedProxies);
    if (limiter.hit(ip).allowed) {
      return next();
    }
    return onLimit(c);
  };
}
