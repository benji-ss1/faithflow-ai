/**
 * Shared rate-limit primitive.
 *
 * Default backend is an in-memory Map (per-lambda-instance) — NOT durable
 * across cold starts or Fluid Compute instances, so the effective limit is
 * roughly `configured_limit x instance_count`.
 *
 * 2026-09-21: `src/lib/rate-limit-redis.ts` implements the shared backend over
 * Upstash REST and installs itself from `instrumentation.ts` when
 * UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set. Without them this
 * in-memory limiter remains, so nothing changes until Redis exists.
 */

export interface RateLimiter {
  check(key: string, opts: { limit: number; windowMs: number }): Promise<boolean>;
  // Peek returns true if the key is currently AT or OVER the limit, WITHOUT
  // incrementing the counter. Used by the login flow to distinguish
  // "already locked out" from "consumed an attempt" — H1's fail-only
  // counting depends on this.
  peek(key: string, opts: { limit: number }): Promise<boolean>;
}

type Hit = { count: number; resetAt: number };

class MemoryLimiter implements RateLimiter {
  private hits = new Map<string, Hit>();

  async check(key: string, opts: { limit: number; windowMs: number }): Promise<boolean> {
    const now = Date.now();
    const cur = this.hits.get(key);
    if (!cur || cur.resetAt < now) {
      this.hits.set(key, { count: 1, resetAt: now + opts.windowMs });
      return true;
    }
    if (cur.count >= opts.limit) return false;
    cur.count++;
    return true;
  }

  async peek(key: string, opts: { limit: number }): Promise<boolean> {
    const now = Date.now();
    const cur = this.hits.get(key);
    if (!cur || cur.resetAt < now) return false;
    return cur.count >= opts.limit;
  }
}

let defaultBackend: RateLimiter = new MemoryLimiter();

export function setRateLimitBackend(backend: RateLimiter) {
  defaultBackend = backend;
}

/** The backend in force. Used by the Redis backend to keep the in-memory one
 *  as its fallback, so a Redis outage degrades to per-instance limits instead
 *  of losing rate limiting altogether. */
export function getRateLimitBackend(): RateLimiter {
  return defaultBackend;
}

/**
 * Named limiters share a namespace so keys from different callers can't
 * collide. Each returns a bound check(key) fn.
 */
export function createLimiter(namespace: string, limit: number, windowMs: number) {
  return async (key: string): Promise<boolean> =>
    defaultBackend.check(`${namespace}:${key}`, { limit, windowMs });
}

// Companion to createLimiter for fail-only counting patterns: check whether
// a key is currently locked out without spending an attempt.
export function createPeeker(namespace: string, limit: number) {
  return async (key: string): Promise<boolean> =>
    defaultBackend.peek(`${namespace}:${key}`, { limit });
}
