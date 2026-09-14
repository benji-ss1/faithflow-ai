import { CredentialsSignin } from "next-auth";

/**
 * SCOPE / TRUST: counters are PER SERVER INSTANCE (in-memory, not shared across
 * Vercel lambdas), and the client IP is taken from Vercel-set proxy headers
 * (x-vercel-forwarded-for first) — correct only because the app is Vercel-hosted
 * behind Vercel's edge. Planned follow-up: a shared DB-backed atomic store.
 */

/**
 * Credentials-login brute-force guard (H1), shared-church-network aware.
 *
 * Three axes, 15-minute fixed windows:
 *  - per-IP        30  — a whole church shares one public IP; 5 (old value)
 *                        let a few operators' typos lock everyone out.
 *  - per-email      5  — can't grind one account from many IPs.
 *  - per-IP+email   5  — one person's typos lock only themselves on that
 *                        network, not colleagues.
 *
 * CHARGE-FIRST: `chargeLoginAttempt` checks all three buckets and increments
 * them in ONE synchronous step (no await in between), BEFORE the DB lookup /
 * bcrypt. The old check → await bcrypt → record-failure flow let N parallel
 * requests all pass the check before any failure was recorded. JS is
 * single-threaded per instance, so this closes that race within an instance.
 *
 * On a successful sign-in `refundLoginSuccess` clears the email and IP+email
 * counters and refunds ONLY this attempt's IP charge (other failures from the
 * IP stay, so one valid account can't launder a credential-stuffing run).
 *
 * Backend: in-memory per instance — counts are not shared across lambda
 * instances, so lockouts can be intermittent (same as rate-limit.ts).
 */
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_IP_LIMIT = 30;
export const LOGIN_EMAIL_LIMIT = 5;
export const LOGIN_IP_EMAIL_LIMIT = 5;

type Hit = { count: number; resetAt: number };
const hits = new Map<string, Hit>();
// Hard memory bound: oldest-first eviction via Map insertion order. Touched
// keys (charged or hit-while-locked) are re-inserted at the tail, so an
// actively-attacked account stays in the map during a random-key flood.
export const LOGIN_MAX_KEYS = 20_000;
const SWEEP_EVERY_MS = 30_000;
let lastSweep = 0;

/** Pure: pick the client IP from proxy headers (Vercel first). */
export function clientIpFromHeaders(h: { get(name: string): string | null } | undefined): string {
  if (!h) return "unknown";
  return (
    h.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip")?.trim() ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/** Raw client-IP strings longer than this collapse to one "invalid-ip" bucket
 *  (bounds key memory; checked before any parsing). */
export const LOGIN_MAX_IP_LEN = 64;

function dottedQuad(s: string): number[] | null {
  const p = s.split(".");
  if (p.length !== 4) return null;
  const n = p.map((x) => (x.length >= 1 && x.length <= 3 && [...x].every((c) => c >= "0" && c <= "9") ? Number(x) : NaN));
  return n.every((x) => x <= 255) ? n : null;
}

/** IPv4 unchanged; ::ffff:a.b.c.d → IPv4; other valid IPv6 → its /64 prefix;
 *  structurally invalid input kept as-is (its own bucket). Regex-free parse. */
export function normalizeIp(raw: string): string {
  if (typeof raw !== "string" || raw.length > LOGIN_MAX_IP_LEN) return "invalid-ip";
  let ip = raw.trim().toLowerCase();
  if (ip.startsWith("[")) ip = ip.slice(1);
  if (ip.endsWith("]")) ip = ip.slice(0, -1);
  ip = ip.split("%")[0];
  if (!ip.includes(":")) return ip;
  const orig = ip;
  const halves = ip.split("::");
  if (halves.length > 2) return orig; // more than one "::" — invalid
  const lastColon = ip.lastIndexOf(":");
  const tailStr = ip.slice(lastColon + 1);
  let quad: number[] | null = null;
  if (tailStr.includes(".")) { // embedded dotted quad → two hex groups
    quad = dottedQuad(tailStr);
    if (!quad) return orig;
    ip = ip.slice(0, lastColon + 1) + ((quad[0] << 8) | quad[1]).toString(16) + ":" + ((quad[2] << 8) | quad[3]).toString(16);
  }
  const isHex = (g: string) => g.length >= 1 && g.length <= 4 && [...g].every((c) => (c >= "0" && c <= "9") || (c >= "a" && c <= "f"));
  let groups: string[];
  if (halves.length === 2) {
    const [head, tail] = ip.split("::");
    const hg = head ? head.split(":") : [];
    const tg = tail ? tail.split(":") : [];
    if (hg.length + tg.length > 7) return orig;
    groups = [...hg, ...Array(8 - hg.length - tg.length).fill("0"), ...tg];
  } else groups = ip.split(":");
  if (groups.length !== 8 || !groups.every(isHex)) return orig; // not valid v6: keep as-is
  if (quad) {
    // Only ::ffff:a.b.c.d maps to IPv4. Other dotted forms (e.g. deprecated
    // ::1.2.3.4) stay distinct rather than merging into ::/64 with ::1.
    const mapped = groups.slice(0, 5).every((g) => parseInt(g, 16) === 0) && parseInt(groups[5], 16) === 0xffff;
    return mapped ? quad.join(".") : orig;
  }
  return groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(":") + "::/64";
}

const keysFor = (rawIp: string, email: string, ip = normalizeIp(rawIp)) =>
  [
    [`ip:${ip}`, LOGIN_IP_LIMIT],
    [`email:${email}`, LOGIN_EMAIL_LIMIT],
    [`ipemail:${ip}|${email}`, LOGIN_IP_EMAIL_LIMIT],
  ] as const;

const limitOf = (key: string) =>
  key.startsWith("ip:") ? LOGIN_IP_LIMIT : key.startsWith("email:") ? LOGIN_EMAIL_LIMIT : LOGIN_IP_EMAIL_LIMIT;

function live(key: string, now: number): Hit | undefined {
  const h = hits.get(key);
  if (h && h.resetAt < now) { hits.delete(key); return undefined; }
  if (h) { hits.delete(key); hits.set(key, h); } // touch → tail (O(1))
  return h;
}

function lockedMinutes(ip: string, email: string, now: number): number | null {
  let ms = -1;
  for (const [key, limit] of keysFor(ip, email)) {
    const h = live(key, now);
    if (h && h.count >= limit) ms = Math.max(ms, h.resetAt - now);
  }
  return ms < 0 ? null : Math.min(15, Math.max(1, Math.ceil(ms / 60000)));
}

/**
 * Synchronous check-and-charge. Returns minutes until unlock if any bucket is
 * already at its limit (nothing charged), else charges all three and returns null.
 */
export function chargeLoginAttempt(ip: string, email: string): number | null {
  const now = Date.now();
  const locked = lockedMinutes(ip, email, now);
  if (locked !== null) return locked;
  if (now - lastSweep >= SWEEP_EVERY_MS) { // expired sweep ≤ once per 30s (amortised O(1))
    lastSweep = now;
    for (const [k, h] of hits) if (h.resetAt < now) hits.delete(k);
  }
  for (const [key] of keysFor(ip, email)) {
    const h = live(key, now);
    if (h) h.count++;
    else {
      // Batch-evict the oldest 10% with ONE iterator: repeated keys().next()
      // after head deletes re-walks V8's tombstones (O(n) per call).
      // Locked keys (at/over limit) are re-queued to the tail, not evicted, so
      // a junk-key flood can't wipe an active lock. Visits are bounded to
      // 2x batch (O(batch)); if nothing could be evicted, drop the head anyway
      // to keep the hard memory bound.
      if (hits.size >= LOGIN_MAX_KEYS) {
        const batch = LOGIN_MAX_KEYS / 10;
        let evicted = 0, visits = 0;
        const requeue: [string, Hit][] = [];
        for (const [k, h] of hits) {
          if (++visits > batch * 2) break;
          if (h.count >= limitOf(k) && h.resetAt >= now) requeue.push([k, h]);
          else evicted++;
          hits.delete(k);
          if (evicted >= batch) break;
        }
        for (const [k, h] of requeue) hits.set(k, h);
        if (evicted === 0) { const k = hits.keys().next().value; if (k !== undefined) hits.delete(k); }
      }
      hits.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    }
  }
  return null;
}

/** Peek only (no charge): minutes until unlock, else null. */
export function loginLockedFor(ip: string, email: string): number | null {
  return lockedMinutes(ip, email, Date.now());
}

/** Test/diagnostic: current number of tracked keys. */
export function loginGuardSize(): number { return hits.size; }

/** Successful sign-in: clear email + IP+email; refund this attempt's IP charge only. */
export function refundLoginSuccess(ip: string, email: string): void {
  const [[ipKey], [emailKey], [ipEmailKey]] = keysFor(ip, email);
  hits.delete(emailKey);
  hits.delete(ipEmailKey);
  const h = live(ipKey, Date.now());
  if (h) { h.count--; if (h.count <= 0) hits.delete(ipKey); }
}

// Distinct error codes surfaced to the client as `res.code`. Never reveal
// whether an email exists: no-user and wrong-password share one code.
export class InvalidCredentialsError extends CredentialsSignin {
  code = "invalid_credentials";
}
export class RateLimitedError extends CredentialsSignin {
  code: string;
  constructor(minutes: number) {
    super();
    // Encoded as "rate_limited:<minutes>" — see auth-error-message.ts.
    this.code = `rate_limited:${minutes}`;
  }
}
