import { CredentialsSignin } from "next-auth";
import { createLimiter, createPeeker, createResetter, createRetryAfter } from "./rate-limit";

/**
 * Credentials-login brute-force guard (H1), shared-church-network aware.
 *
 * Three fail-only axes, 15-minute windows:
 *  - per-IP        30  — a whole church shares one public IP; 5 (old value)
 *                        let a few operators' typos lock everyone out.
 *  - per-email      5  — can't grind one account from many IPs.
 *  - per-IP+email   5  — one person's typos lock only themselves on that
 *                        network, not colleagues.
 * A successful sign-in clears the email and IP+email counters (NOT the IP
 * counter, so an attacker holding one valid account can't launder a
 * credential-stuffing run from the same IP).
 *
 * Backend: in-memory per instance (rate-limit.ts). No DB-backed helper for
 * the rate_limits table exists in src/, so counts are not shared across
 * lambda instances — lockouts can be intermittent. See rate-limit.ts.
 */
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_IP_LIMIT = 30;
export const LOGIN_EMAIL_LIMIT = 5;
export const LOGIN_IP_EMAIL_LIMIT = 5;

const chargeIp = createLimiter("login-ip", LOGIN_IP_LIMIT, LOGIN_WINDOW_MS);
const chargeEmail = createLimiter("login-email", LOGIN_EMAIL_LIMIT, LOGIN_WINDOW_MS);
const chargeIpEmail = createLimiter("login-ip-email", LOGIN_IP_EMAIL_LIMIT, LOGIN_WINDOW_MS);
const peekIp = createPeeker("login-ip", LOGIN_IP_LIMIT);
const peekEmail = createPeeker("login-email", LOGIN_EMAIL_LIMIT);
const peekIpEmail = createPeeker("login-ip-email", LOGIN_IP_EMAIL_LIMIT);
const resetEmail = createResetter("login-email");
const resetIpEmail = createResetter("login-ip-email");
const retryIp = createRetryAfter("login-ip");
const retryEmail = createRetryAfter("login-email");
const retryIpEmail = createRetryAfter("login-ip-email");

const ipEmailKey = (ip: string, email: string) => `${ip}|${email}`;

/** Returns minutes until unlock (>=1) if locked on any axis, else null. Does not charge. */
export async function loginLockedFor(ip: string, email: string): Promise<number | null> {
  const locks: Promise<number>[] = [];
  if (await peekIp(ip)) locks.push(retryIp(ip));
  if (await peekEmail(email)) locks.push(retryEmail(email));
  if (await peekIpEmail(ipEmailKey(ip, email))) locks.push(retryIpEmail(ipEmailKey(ip, email)));
  if (locks.length === 0) return null;
  const ms = Math.max(...(await Promise.all(locks)));
  return Math.max(1, Math.ceil(ms / 60000));
}

export async function recordLoginFailure(ip: string, email: string): Promise<void> {
  await chargeIp(ip);
  await chargeEmail(email);
  await chargeIpEmail(ipEmailKey(ip, email));
}

export async function recordLoginSuccess(ip: string, email: string): Promise<void> {
  await resetEmail(email);
  await resetIpEmail(ipEmailKey(ip, email));
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
