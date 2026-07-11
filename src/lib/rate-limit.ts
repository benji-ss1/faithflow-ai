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
