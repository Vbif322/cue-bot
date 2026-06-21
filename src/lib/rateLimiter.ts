// In-memory token-bucket rate limiter. Pure (no DB, no I/O) so it is cheap enough
// to run in front of every bot update and is fully unit-testable via an injectable
// clock. State is per-process and resets on restart — acceptable for throttling.

export interface RateLimiterOptions {
  /** Maximum burst — how many hits are allowed back-to-back from a cold bucket. */
  capacity: number;
  /** Sustained rate at which tokens refill, in tokens per second. */
  refillPerSec: number;
  /** Clock injection point; defaults to Date.now. */
  now?: () => number;
  /**
   * Soft cap on tracked keys: once exceeded, {@link RateLimiter.hit} opportunistically
   * prunes idle/full buckets so the map cannot grow unbounded under a wide key space.
   */
  maxKeysBeforePrune?: number;
}

export interface HitResult {
  /** Whether this hit is permitted. */
  allowed: boolean;
  /**
   * True exactly once per rejection streak — on the first rejected hit after the
   * bucket was last allowed. Drives "warn the user once, then go quiet" so a flood
   * does not amplify into a flood of replies.
   */
  firstReject: boolean;
}

interface Bucket {
  /** Fractional token count, refilled lazily on access. */
  tokens: number;
  /** Timestamp (ms) of the last refill calculation. */
  last: number;
  /** Whether the bucket is currently in a rejection streak. */
  rejecting: boolean;
}

const DEFAULT_MAX_KEYS_BEFORE_PRUNE = 10_000;

export class RateLimiter {
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly now: () => number;
  private readonly maxKeysBeforePrune: number;
  private readonly buckets = new Map<string, Bucket>();

  constructor(opts: RateLimiterOptions) {
    if (opts.capacity <= 0) {
      throw new Error('RateLimiter: capacity must be > 0');
    }
    if (opts.refillPerSec <= 0) {
      throw new Error('RateLimiter: refillPerSec must be > 0');
    }
    this.capacity = opts.capacity;
    this.refillPerMs = opts.refillPerSec / 1000;
    this.now = opts.now ?? Date.now;
    this.maxKeysBeforePrune = opts.maxKeysBeforePrune ?? DEFAULT_MAX_KEYS_BEFORE_PRUNE;
  }

  /** Refill a bucket to the current time, clamped to capacity. */
  private refill(bucket: Bucket, nowMs: number): void {
    const elapsed = nowMs - bucket.last;
    if (elapsed <= 0) return;
    bucket.tokens = Math.min(
      this.capacity,
      bucket.tokens + elapsed * this.refillPerMs,
    );
    bucket.last = nowMs;
  }

  /** Register a hit for `key` and report whether it is allowed. */
  hit(key: string | number): HitResult {
    const id = String(key);
    const nowMs = this.now();

    let bucket = this.buckets.get(id);
    if (!bucket) {
      if (this.buckets.size >= this.maxKeysBeforePrune) {
        this.prune();
      }
      bucket = { tokens: this.capacity, last: nowMs, rejecting: false };
      this.buckets.set(id, bucket);
    } else {
      this.refill(bucket, nowMs);
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      bucket.rejecting = false;
      return { allowed: true, firstReject: false };
    }

    const firstReject = !bucket.rejecting;
    bucket.rejecting = true;
    return { allowed: false, firstReject };
  }

  /**
   * Drop buckets that have fully refilled and are not mid-rejection — recreating
   * such a bucket yields an identical cold state, so removing it is lossless.
   * Returns the number of buckets removed.
   */
  prune(): number {
    const nowMs = this.now();
    let removed = 0;
    for (const [id, bucket] of this.buckets) {
      this.refill(bucket, nowMs);
      if (bucket.tokens >= this.capacity && !bucket.rejecting) {
        this.buckets.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  /** Number of currently tracked keys (for tests/diagnostics). */
  get size(): number {
    return this.buckets.size;
  }
}
