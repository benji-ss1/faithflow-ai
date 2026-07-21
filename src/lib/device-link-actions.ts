"use server";

/**
 * One-time token that lets the desktop app open pre-authenticated after the
 * user signs in on the website (download page) — no separate login screen
 * inside the Electron window. Reuses the existing `authTokens` table/kind
 * pattern (verify_email, password_reset) rather than a new table: same
 * shape (userId + sha256 hash + expiry + single-use), just a new `kind`.
 *
 * TTL is short (5 min) because this is consumed within seconds of minting —
 * the user clicks "Open PresentFlow" right after downloading, not later.
 */

import { requireUser } from "./session";
import { issueAuthToken } from "./auth-tokens";
import { createLimiter } from "./rate-limit";

const TTL_MS = 5 * 60 * 1000;
const mintLimiter = createLimiter("device-link-mint", 10, 60 * 60 * 1000);

export async function mintDeviceLinkToken(): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!(await mintLimiter(user.id))) {
    return { ok: false, error: "Too many link attempts. Please wait a few minutes and try again." };
  }
  const token = await issueAuthToken(user.id, "device_link", TTL_MS);
  return { ok: true, token };
}
