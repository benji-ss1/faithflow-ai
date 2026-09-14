import { CredentialsSignin } from "next-auth";

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

const keysFor = (ip: string, email: string) =>
  [
    [`ip:${ip}`, LOGIN_IP_LIMIT],
    [`email:${email}`, LOGIN_EMAIL_LIMIT],
    [`ipemail:${ip}|${email}`, LOGIN_IP_EMAIL_LIMIT],
  ] as const;

function live(key: string, now: number): Hit | undefined {
  const h = hits.get(key);
  if (h && h.resetAt < now) { hits.delete(key); return undefined; }
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
  if (hits.size > 50_000) for (const [k, h] of hits) if (h.resetAt < now) hits.delete(k);
  for (const [key] of keysFor(ip, email)) {
    const h = live(key, now);
    if (h) h.count++;
    else hits.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  }
  return null;
}

/** Peek only (no charge): minutes until unlock, else null. */
export function loginLockedFor(ip: string, email: string): number | null {
  return lockedMinutes(ip, email, Date.now());
}

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
