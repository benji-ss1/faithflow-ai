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
 *  - per-IP        50  — a whole church shares one public IP; 5 (old value)
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
export const LOGIN_IP_LIMIT = 50; // 15 operators x 2 typos must not lock a church network
export const LOGIN_EMAIL_LIMIT = 5;
export const LOGIN_IP_EMAIL_LIMIT = 5;

type Hit = { count: number; resetAt: number };
/** Attempt COUNTERS. `hits` is the O(1) index; every key also lives in exactly
 *  one COUNT TIER (insertion-ordered Map per current count, email scope kept
 *  separate). Eviction takes the lowest non-email tier first, then the lowest
 *  email tier, oldest-first within a tier — so a flood of fresh count-1 junk can
 *  never age out a target's count-4 email counter; wiping it needs ~LOGIN_MAX_KEYS
 *  email counters at count ≥ 4 (≈ 80k attempts), comparable to breaking a lock.
 *  A counter at its limit has already been copied into the lock store, so
 *  evicting counters can never release a lock. */
const hits = new Map<string, Hit>();
const TOP_TIER = LOGIN_IP_LIMIT; // counts ≥ this share the top tier
const emailTiers = Array.from({ length: TOP_TIER + 1 }, () => new Map<string, Hit>());
const otherTiers = Array.from({ length: TOP_TIER + 1 }, () => new Map<string, Hit>());
const tierOf = (key: string, count: number) =>
  (key.startsWith("email:") ? emailTiers : otherTiers)[Math.max(0, Math.min(count, TOP_TIER))];
function dropHit(key: string): void {
  const h = hits.get(key);
  if (h) { hits.delete(key); tierOf(key, h.count).delete(key); }
}
/** Batch (10%) eviction, O(batch + tiers): lowest tier first, other scopes before email. */
function evictCounters(): void {
  let n = LOGIN_MAX_KEYS / 10;
  for (const tiers of [otherTiers, emailTiers]) for (const t of tiers) {
    for (const k of t.keys()) { t.delete(k); hits.delete(k); if (--n === 0) return; }
  }
}
export const LOGIN_MAX_KEYS = 20_000;
/** LOCK STORE (key → lockedUntil). Junk counter inserts never touch it. Split
 *  by scope so eviction can prefer IP / IP+email locks over email locks
 *  (email locks protect accounts). */
const emailLocks = new Map<string, number>();
const otherLocks = new Map<string, number>();
export const LOGIN_MAX_LOCKS = 50_000;
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

/** IPv4 unchanged; ::ffff:a.b.c.d → IPv4; other valid IPv6 (incl. embedded quad) → its /64 prefix;
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
  // Only ::ffff:a.b.c.d maps to IPv4. Other embedded-quad forms (64:ff9b::1.2.3.4,
  // 2001:db8:1:1::1.2.3.4, ::1.2.3.4) group by /64 like any IPv6 (as b58aa6d) —
  // keeping them distinct let an attacker rotate the quad inside one /64.
  if (quad && groups.slice(0, 5).every((g) => parseInt(g, 16) === 0) && parseInt(groups[5], 16) === 0xffff) return quad.join(".");
  return groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(":") + "::/64";
}

const keysFor = (rawIp: string, email: string, ip = normalizeIp(rawIp)) =>
  [
    [`ip:${ip}`, LOGIN_IP_LIMIT],
    [`email:${email}`, LOGIN_EMAIL_LIMIT],
    [`ipemail:${ip}|${email}`, LOGIN_IP_EMAIL_LIMIT],
  ] as const;

const lockMap = (key: string) => (key.startsWith("email:") ? emailLocks : otherLocks);

function live(key: string, now: number): Hit | undefined {
  const h = hits.get(key);
  if (h && h.resetAt < now) { dropHit(key); return undefined; }
  return h;
}

/**
 * Lock-store eviction, only when full. Batched (10% of the cap) so the O(n)
 * scan runs at most once per LOGIN_MAX_LOCKS/10 lock inserts → O(1) amortised.
 *  1. drop every EXPIRED lock (both scopes);
 *  2. if still short of the batch, drop the locks with the EARLIEST lockedUntil
 *     (closest to expiring anyway = least protection lost), taking IP / IP+email
 *     locks first and email locks only if no others remain.
 * Residual limit (documented): an attacker who creates > LOGIN_MAX_LOCKS live
 * email locks (≥ 250k requests in one window, per instance) can age out the
 * earliest-expiring email lock; its counter may still hold it.
 */
function makeLockRoom(now: number): void {
  if (emailLocks.size + otherLocks.size < LOGIN_MAX_LOCKS) return;
  const batch = LOGIN_MAX_LOCKS / 10;
  let freed = 0;
  for (const m of [otherLocks, emailLocks]) for (const [k, u] of m) if (u < now) { m.delete(k); freed++; }
  for (const m of [otherLocks, emailLocks]) {
    let need = batch - freed;
    if (need <= 0) return;
    if (m.size <= need) { freed += m.size; m.clear(); continue; }
    const until = Float64Array.from(m.values()).sort();
    const cut = until[need - 1];
    for (const [k, u] of m) { if (u <= cut) { m.delete(k); freed++; if (--need === 0) break; } }
  }
}

function setLock(key: string, until: number, now: number): void {
  const m = lockMap(key);
  if (!m.has(key)) makeLockRoom(now);
  m.set(key, Math.max(until, m.get(key) ?? 0));
}

function lockedMinutes(ip: string, email: string, now: number): number | null {
  let ms = -1;
  for (const [key, limit] of keysFor(ip, email)) {
    const m = lockMap(key);
    const u = m.get(key);
    if (u !== undefined) { if (u < now) m.delete(key); else ms = Math.max(ms, u - now); }
    const h = live(key, now);
    if (h && h.count >= limit) ms = Math.max(ms, h.resetAt - now);
  }
  return ms < 0 ? null : Math.min(15, Math.max(1, Math.ceil(ms / 60000)));
}

/**
 * Synchronous check-and-charge. Returns minutes until unlock if any bucket is
 * locked (lock store first, then counters; nothing charged), else charges all
 * three and returns null. A bucket reaching its limit is recorded in the lock store.
 */
export function chargeLoginAttempt(ip: string, email: string): number | null {
  const now = Date.now();
  const locked = lockedMinutes(ip, email, now);
  if (locked !== null) return locked;
  if (now - lastSweep >= SWEEP_EVERY_MS) { // expired sweep ≤ once per 30s (amortised O(1))
    lastSweep = now;
    for (const [k, h] of hits) if (h.resetAt < now) dropHit(k);
    for (const m of [otherLocks, emailLocks]) for (const [k, u] of m) if (u < now) m.delete(k);
  }
  for (const [key, limit] of keysFor(ip, email)) {
    let h = live(key, now);
    if (h) { tierOf(key, h.count).delete(key); h.count++; } // move tier → tail (O(1))
    else {
      if (hits.size >= LOGIN_MAX_KEYS) evictCounters(); // locks live in the separate lock store
      h = { count: 1, resetAt: now + LOGIN_WINDOW_MS };
      hits.set(key, h);
    }
    tierOf(key, h.count).set(key, h);
    if (h.count >= limit) setLock(key, h.resetAt, now);
  }
  return null;
}

/** Peek only (no charge): minutes until unlock, else null. */
export function loginLockedFor(ip: string, email: string): number | null {
  return lockedMinutes(ip, email, Date.now());
}

/** Test/diagnostic: current number of tracked counter keys. */
export function loginGuardSize(): number { return hits.size; }
/** Test/diagnostic: current number of stored locks. */
export function loginLockCount(): number { return emailLocks.size + otherLocks.size; }

/** Successful sign-in: clear email + IP+email (counters AND locks); refund this
 *  attempt's IP charge only (its lock is lifted only if that drops it below limit). */
export function refundLoginSuccess(ip: string, email: string): void {
  const [[ipKey, ipLimit], [emailKey], [ipEmailKey]] = keysFor(ip, email);
  dropHit(emailKey); emailLocks.delete(emailKey);
  dropHit(ipEmailKey); otherLocks.delete(ipEmailKey);
  const h = live(ipKey, Date.now());
  if (h) {
    tierOf(ipKey, h.count).delete(ipKey);
    h.count--;
    if (h.count < ipLimit) otherLocks.delete(ipKey);
    if (h.count <= 0) hits.delete(ipKey); else tierOf(ipKey, h.count).set(ipKey, h);
  }
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
