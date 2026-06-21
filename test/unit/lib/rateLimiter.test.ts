import { describe, expect, it } from 'vitest';

import { RateLimiter } from '@/lib/rateLimiter.js';

/** A controllable clock for deterministic refill tests. */
function fakeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('RateLimiter', () => {
  it('allows up to capacity in a cold burst, then rejects', () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({
      capacity: 3,
      refillPerSec: 1,
      now: clock.now,
    });

    expect(limiter.hit('a').allowed).toBe(true);
    expect(limiter.hit('a').allowed).toBe(true);
    expect(limiter.hit('a').allowed).toBe(true);
    expect(limiter.hit('a').allowed).toBe(false);
  });

  it('refills over time at refillPerSec', () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({
      capacity: 2,
      refillPerSec: 1,
      now: clock.now,
    });

    limiter.hit('a');
    limiter.hit('a');
    expect(limiter.hit('a').allowed).toBe(false);

    clock.advance(1000); // one token back
    expect(limiter.hit('a').allowed).toBe(true);
    expect(limiter.hit('a').allowed).toBe(false);
  });

  it('clamps refill to capacity (no token hoarding)', () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({
      capacity: 2,
      refillPerSec: 1,
      now: clock.now,
    });

    limiter.hit('a');
    limiter.hit('a');
    clock.advance(60_000); // long idle — still capped at 2

    expect(limiter.hit('a').allowed).toBe(true);
    expect(limiter.hit('a').allowed).toBe(true);
    expect(limiter.hit('a').allowed).toBe(false);
  });

  it('reports firstReject exactly once per rejection streak', () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({
      capacity: 1,
      refillPerSec: 1,
      now: clock.now,
    });

    expect(limiter.hit('a')).toEqual({ allowed: true, firstReject: false });
    expect(limiter.hit('a')).toEqual({ allowed: false, firstReject: true });
    expect(limiter.hit('a')).toEqual({ allowed: false, firstReject: false });

    // Recover, then a fresh rejection streak flags firstReject again.
    clock.advance(1000);
    expect(limiter.hit('a').allowed).toBe(true);
    expect(limiter.hit('a')).toEqual({ allowed: false, firstReject: true });
  });

  it('isolates buckets per key', () => {
    const limiter = new RateLimiter({ capacity: 1, refillPerSec: 1 });

    expect(limiter.hit('a').allowed).toBe(true);
    expect(limiter.hit('a').allowed).toBe(false);
    // 'b' is unaffected by 'a' exhaustion.
    expect(limiter.hit('b').allowed).toBe(true);
  });

  it('prune drops fully-refilled idle buckets, keeps active ones', () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({
      capacity: 2,
      refillPerSec: 1,
      now: clock.now,
    });

    limiter.hit('idle'); // 1 token left
    limiter.hit('busy');
    limiter.hit('busy'); // exhausted
    expect(limiter.size).toBe(2);

    clock.advance(10_000); // both fully refill, but 'busy' is mid-rejection? no — not hit since
    // 'idle' refilled to capacity; 'busy' also refilled to capacity and not rejecting.
    expect(limiter.prune()).toBe(2);
    expect(limiter.size).toBe(0);
  });

  it('prune keeps a bucket still in a rejection streak', () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({
      capacity: 1,
      refillPerSec: 1,
      now: clock.now,
    });

    limiter.hit('a');
    limiter.hit('a'); // rejecting = true
    // Even after time passes, prune must not drop a rejecting bucket (would lose
    // the firstReject suppression state).
    expect(limiter.prune()).toBe(0);
    expect(limiter.size).toBe(1);
  });

  it('soft-prunes when key count exceeds maxKeysBeforePrune', () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({
      capacity: 1,
      refillPerSec: 1,
      now: clock.now,
      maxKeysBeforePrune: 3,
    });

    limiter.hit('a');
    limiter.hit('b');
    limiter.hit('c');
    clock.advance(10_000); // a, b, c refill to full
    // Adding a 4th key triggers a prune of the idle full buckets first.
    limiter.hit('d');
    expect(limiter.size).toBe(1);
  });

  it('rejects invalid options', () => {
    expect(() => new RateLimiter({ capacity: 0, refillPerSec: 1 })).toThrow();
    expect(() => new RateLimiter({ capacity: 1, refillPerSec: 0 })).toThrow();
  });
});
