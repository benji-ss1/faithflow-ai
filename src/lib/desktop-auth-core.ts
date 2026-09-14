// Pure (DB-free) primitives for desktop auto sign-in. Unit-tested in
// test/desktop-auth-core.test.ts. Server-only: uses AUTH_SECRET.
//
//  - Pairing CODE: 8 chars from a 32-symbol unambiguous alphabet (40 bits),
//    shown to the operator as XXXX-XXXX. Only its hash ever touches the DB.
//  - Pairing TICKET: an HMAC-signed, expiring blob the desktop keeps and sends
//    when polling. It binds the poller to one code hash, so polling can't be
//    used to enumerate codes (a forged ticket fails the signature), and no
//    DB row exists until a signed-in user approves (auth_tokens.user_id is
//    NOT NULL — this avoids a schema change).
//  - CONFIRM token: CSRF token for the "switch account on this computer?"
//    POST, bound to the current session user + the device-link token hash.

import crypto from "node:crypto";

export const PAIR_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const PAIR_CODE_LEN = 8;
export const PAIR_TTL_MS = 10 * 60 * 1000;
export const CONFIRM_TTL_MS = 10 * 60 * 1000;

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not configured");
  return s;
}

function hmac(label: string, data: string): string {
  return crypto.createHmac("sha256", secret()).update(`${label}:${data}`).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function generatePairCode(): string {
  let out = "";
  const bytes = crypto.randomBytes(PAIR_CODE_LEN);
  // 256 % 32 === 0, so byte % 32 is unbiased.
  for (let i = 0; i < PAIR_CODE_LEN; i++) out += PAIR_CODE_ALPHABET[bytes[i] % 32];
  return out;
}

export function formatPairCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Uppercase, strip spaces/dashes, map easily-confused glyphs. null if invalid. */
export function normalizePairCode(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 32) return null;
  // Alphabet omits 0/O/1/I, so a mistyped confusable simply fails validation.
  const c = input.toUpperCase().replace(/[\s-]/g, "");
  if (c.length !== PAIR_CODE_LEN) return null;
  for (const ch of c) if (!PAIR_CODE_ALPHABET.includes(ch)) return null;
  return c;
}

/** Keyed (HMAC, AUTH_SECRET-derived) so a DB dump of code hashes can't be
 *  brute-forced over the 40-bit code space offline. */
export function pairCodeHash(code: string): string {
  return crypto.createHmac("sha256", secret()).update(`device_pair:${code}`).digest("hex");
}

// ── Pairing request metadata (shown to the approver on /link) ───────────────

export const PAIR_UA_MAX = 256;

/** Vercel geo headers are URI-encoded (x-vercel-ip-city: "S%C3%A3o%20Paulo"). */
export function decodeGeoHeader(v: string | null | undefined, max = 80): string | null {
  if (!v) return null;
  let out = v;
  try { out = decodeURIComponent(v); } catch { /* keep raw */ }
  out = [...out].filter((ch) => { const c = ch.charCodeAt(0); return c > 31 && c !== 127 && ch !== "<" && ch !== ">"; }).join("").trim().slice(0, max);
  return out || null;
}

export function readGeo(headers: { get(name: string): string | null }): { country: string | null; city: string | null } {
  const country = decodeGeoHeader(headers.get("x-vercel-ip-country"), 8);
  return { country: country ? country.toUpperCase() : null, city: decodeGeoHeader(headers.get("x-vercel-ip-city")) };
}

/** Rough, human-readable "Browser on OS" from a User-Agent. Display only. */
export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  const os =
    /Windows NT/i.test(ua) ? "Windows" :
    /iPhone|iPad|iPod/i.test(ua) ? "iOS" :
    /Mac OS X|Macintosh/i.test(ua) ? "macOS" :
    /Android/i.test(ua) ? "Android" :
    /CrOS/i.test(ua) ? "ChromeOS" :
    /Linux/i.test(ua) ? "Linux" : "Unknown OS";
  const app =
    /PresentFlow|Electron/i.test(ua) ? "PresentFlow desktop app" :
    /Edg\//i.test(ua) ? "Edge" :
    /OPR\//i.test(ua) ? "Opera" :
    /Firefox\//i.test(ua) ? "Firefox" :
    /Chrome\//i.test(ua) ? "Chrome" :
    /Safari\//i.test(ua) ? "Safari" : "Unknown browser";
  return `${app} on ${os}`;
}

export function describeLocation(city: string | null, country: string | null): string {
  if (city && country) return `${city}, ${country}`;
  return city || country || "Unknown location";
}

/** Strong-warning trigger: both countries known AND different. Unknown on
 *  either side is not treated as a mismatch (local dev / missing geo). */
export function isGeoMismatch(requestCountry: string | null | undefined, approverCountry: string | null | undefined): boolean {
  if (!requestCountry || !approverCountry) return false;
  return requestCountry.trim().toUpperCase() !== approverCountry.trim().toUpperCase();
}

// ── Session revocation / absolute lifetime ──────────────────────────────────

export const SESSION_ABSOLUTE_MAX_MS = 180 * 24 * 60 * 60 * 1000;

/**
 * Pure verdict for an existing session JWT. `authTime` is the ORIGINAL sign-in
 * time (preserved across rolling refreshes); `tokenVersion` the users.session_version
 * copied in at sign-in; `dbVersion` the current DB value (undefined = not loaded
 * this call). Legacy tokens (pre-hardening) lack both: treated as version 0 and
 * authTime is stamped on first refresh by the caller.
 */
export function sessionTokenVerdict(input: { authTime?: unknown; tokenVersion?: unknown; dbVersion?: number; now?: number }): "ok" | "expired" | "revoked" {
  const now = input.now ?? Date.now();
  const at = Number(input.authTime);
  if (input.authTime !== undefined && (!Number.isFinite(at) || now - at > SESSION_ABSOLUTE_MAX_MS)) return "expired";
  if (input.dbVersion !== undefined) {
    const tv = input.tokenVersion === undefined ? 0 : Number(input.tokenVersion);
    if (tv !== input.dbVersion) return "revoked";
  }
  return "ok";
}

// ── Pair-exchange marker (skip the no-session confirm page) ─────────────────
// Set as an httpOnly cookie on the POLL response in the same window that polled,
// bound to the exchange token. A forwarded exchange URL opened elsewhere lacks
// it and gets the confirm page (login-CSRF protection).

export const PAIR_MARKER_COOKIE = "pf_pair_x";

export function signPairExchangeMarker(exchangeToken: string): string {
  return hmac("pf-pair-exchange", tokenHash(exchangeToken));
}

export function verifyPairExchangeMarker(marker: unknown, exchangeToken: string): boolean {
  return typeof marker === "string" && marker.length < 200 && safeEqual(marker, signPairExchangeMarker(exchangeToken));
}

type TicketPayload = { v: 1; h: string; n: string; e: number };

export function signPairTicket(code: string, now = Date.now()): { ticket: string; expiresAt: number; nonce: string } {
  const payload: TicketPayload = { v: 1, h: pairCodeHash(code), n: crypto.randomBytes(12).toString("base64url"), e: now + PAIR_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { ticket: `${body}.${hmac("pf-desktop-pair", body)}`, expiresAt: payload.e, nonce: payload.n };
}

export function verifyPairTicket(ticket: unknown, now = Date.now()): { codeHash: string; nonce: string; expiresAt: number } | null {
  if (typeof ticket !== "string" || ticket.length > 512) return null;
  const dot = ticket.indexOf(".");
  if (dot <= 0) return null;
  const body = ticket.slice(0, dot);
  const sig = ticket.slice(dot + 1);
  if (!safeEqual(sig, hmac("pf-desktop-pair", body))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TicketPayload;
    if (p.v !== 1 || typeof p.h !== "string" || typeof p.n !== "string" || typeof p.e !== "number") return null;
    if (p.e < now) return null;
    return { codeHash: p.h, nonce: p.n, expiresAt: p.e };
  } catch {
    return null;
  }
}

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function signExchangeConfirm(sessionUserId: string, deviceToken: string, now = Date.now()): string {
  const exp = now + CONFIRM_TTL_MS;
  return `${exp}.${hmac("pf-dx-confirm", `${sessionUserId}:${tokenHash(deviceToken)}:${exp}`)}`;
}

export function verifyExchangeConfirm(csrf: unknown, sessionUserId: string, deviceToken: string, now = Date.now()): boolean {
  if (typeof csrf !== "string" || csrf.length > 200) return false;
  const dot = csrf.indexOf(".");
  if (dot <= 0) return false;
  const exp = Number(csrf.slice(0, dot));
  if (!Number.isFinite(exp) || exp < now) return false;
  return safeEqual(csrf.slice(dot + 1), hmac("pf-dx-confirm", `${sessionUserId}:${tokenHash(deviceToken)}:${exp}`));
}

export type ExchangeDecision = "exchange" | "same-user" | "confirm" | "confirm-signin" | "invalid";

/** CSRF subject for the no-session "Sign in as …?" confirm POST. */
export const ANON_CONFIRM_SUBJECT = "anon";

/**
 * What GET /api/auth/device-exchange should do. A token for a DIFFERENT user
 * than the one already signed in must never swap silently — it needs an
 * explicit, CSRF-protected confirm POST.
 */
export function decideExchange(
  sessionUserId: string | null,
  tokenUserId: string | null,
  opts: { pairMarkerValid?: boolean } = {},
): ExchangeDecision {
  if (!tokenUserId) return "invalid";
  // No session: only the window that completed pairing (valid marker cookie)
  // exchanges silently. A bare deep link / forwarded URL must confirm, so an
  // attacker can't log a victim's desktop into the ATTACKER's account.
  if (!sessionUserId) return opts.pairMarkerValid ? "exchange" : "confirm-signin";
  if (sessionUserId === tokenUserId) return "same-user";
  return "confirm";
}

/** Same-origin check for the confirm POST (middleware exempts /api/auth/ from its CSRF gate). */
export function isSameOriginPost(headers: { get(name: string): string | null }): boolean {
  const site = headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return false;
  const origin = headers.get("origin");
  // Proxies may append: "a.example, b.internal" — the first hop is the client-facing host.
  const host = headers.get("x-forwarded-host")?.split(",")[0]?.trim() || headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
