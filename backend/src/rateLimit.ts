type BucketState = { count: number; resetAt: number };

export type RateLimitConfig = {
  limit: number;
  windowMs: number;
};

// Simple per-DO-instance in-memory limiter (good enough for free-tier MVP).
export class MemoryRateLimiter {
  private buckets = new Map<string, BucketState>();

  constructor(private cfg: RateLimitConfig) {}

  allow(key: string, nowMs = Date.now()): { ok: true } | { ok: false; retryAfterMs: number } {
    const cur = this.buckets.get(key);
    if (!cur || cur.resetAt <= nowMs) {
      this.buckets.set(key, { count: 1, resetAt: nowMs + this.cfg.windowMs });
      return { ok: true };
    }
    if (cur.count >= this.cfg.limit) {
      return { ok: false, retryAfterMs: Math.max(0, cur.resetAt - nowMs) };
    }
    cur.count += 1;
    return { ok: true };
  }
}

