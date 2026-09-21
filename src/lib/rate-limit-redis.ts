/**
 * Shared (cross-instance) rate-limit backend, on Upstash Redis REST.
 *
 * WHY: every limiter — login 5/15min, signup, password reset, the Deepgram
 * audio-ticket spend gate, media presign — was backed by a process-local Map.
 * On Vercel with Fluid Compute + elastic concurrency there are many warm
 * instances, each with its own independent counter, and every counter dies on
 * a cold start or a deploy. So the effective limit was roughly
 * `configured_limit x instance_count`, and unknowable. At 20 churches that gets
 * worse, not better. This makes the counter shared, so the number in the code
 * is the number that is actually enforced.
 *
 * REST, not a TCP client, on purpose: no connection pool to exhaust, no new
 * dependency, and it works unchanged on serverless. Plain `fetch`.
 *
 * DEGRADES, NEVER LOCKS OUT: if Redis is unreachable we fall back to the
 * in-memory limiter rather than failing open (no protection) or failing closed
 * (locking out a church mid-Sunday). Degraded protection beats either extreme.
 *
 * Enable by setting a REST url + token. Vercel's Upstash Marketplace
 * integration provisions these as `KV_REST_API_URL` / `KV_REST_API_TOKEN`
 * (provisioned 2026-09-21, store `upstash-kv-champagne-diamond`); the
 * `UPSTASH_REDIS_REST_*` names are accepted too for a hand-rolled instance.
 * Neither present ⇒ this file does nothing and the in-memory limiter stays.
 */
import { getRateLimitBackend, setRateLimitBackend, type RateLimiter } from "./rate-limit";

type Cmd = (string | number)[];

export class UpstashRateLimiter implements RateLimiter {
  private failures = 0;
  private warned = false;

  constructor(
    private url: string,
    private token: string,
    /** Used whenever Redis is unreachable, so we never lose protection entirely. */
    private fallback: RateLimiter,
  ) {}

  /** Upstash pipeline: array of commands in, array of `{result}` out. */
  private async pipeline(cmds: Cmd[]): Promise<unknown[]> {
    const res = await fetch(`${this.url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(cmds),
      // A rate limiter must never become the slowest thing in the request.
      signal: AbortSignal.timeout(2_000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`upstash ${res.status}`);
    const json = (await res.json()) as { result?: unknown; error?: string }[];
    return json.map((r) => r.result);
  }

  private degrade(e: unknown): void {
    this.failures += 1;
    if (!this.warned) {
      this.warned = true;
      console.error("[rate-limit] Redis unreachable — falling back to per-instance limits:",
        e instanceof Error ? e.message : e);
    }
  }

  async check(key: string, opts: { limit: number; windowMs: number }): Promise<boolean> {
    try {
      // INCR then set the TTL only on first hit, so the window is fixed from
      // the first request rather than sliding forward on every call (which
      // would let a steady attacker keep the key alive indefinitely).
      const [count] = await this.pipeline([["INCR", key]]) as [number];
      if (count === 1) {
        await this.pipeline([["PEXPIRE", key, Math.max(1, Math.round(opts.windowMs))]]);
      }
      return count <= opts.limit;
    } catch (e) {
      this.degrade(e);
      return this.fallback.check(key, opts);
    }
  }

  async peek(key: string, opts: { limit: number }): Promise<boolean> {
    try {
      const [raw] = await this.pipeline([["GET", key]]) as [string | null];
      if (raw === null || raw === undefined) return false;
      const count = Number(raw);
      return Number.isFinite(count) && count >= opts.limit;
    } catch (e) {
      this.degrade(e);
      return this.fallback.peek(key, opts);
    }
  }

  /** Ops/diagnostics: how many times we have had to degrade this lifetime. */
  degradedCount(): number { return this.failures; }
}

/**
 * Install the shared backend if it is configured. Safe to call more than once
 * and safe when the env is absent — returns what it did so startup can log it.
 */
export function installSharedRateLimiter(): "redis" | "memory" {
  // Vercel's Upstash integration uses the KV_* names; support both.
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return "memory";
  setRateLimitBackend(new UpstashRateLimiter(url, token, getRateLimitBackend()));
  return "redis";
}
