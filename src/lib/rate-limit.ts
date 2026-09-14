/**
 * Shared rate-limit primitive.
 *
 * Default backend is an in-memory Map (per-lambda-instance). Fine for the
 * pilot demo; not durable across cold starts or Fluid Compute instances.
 * When we move to shared state, swap `defaultBackend` for a Redis/Upstash
 * implementation — every caller keeps working because they only touch the
 * `RateLimiter` interface below.
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
