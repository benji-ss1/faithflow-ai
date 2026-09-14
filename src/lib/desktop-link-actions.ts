"use server";

import { requireUser } from "./session";
import { approvePairingForUser, type ApproveResult } from "./desktop-pair";
import { createLimiter } from "./rate-limit";

// Web-side approval of a desktop pairing code (/link page). Requires a full
// web session (requireUser redirects to /login otherwise); the approval row is
// bound to THAT user id only. Rate-limited per user to make code guessing
// (to push your own account onto someone else's desktop) impractical on top of
// the 40-bit code space.
const approveLimiter = createLimiter("device-pair-approve", 10, 10 * 60 * 1000);

export async function approveDesktopPairing(code: string): Promise<ApproveResult> {
  const user = await requireUser();
  if (!(await approveLimiter(user.id))) {
    return { ok: false, error: "Too many attempts. Please wait a few minutes and try again." };
  }
  return approvePairingForUser(user.id, code);
}
