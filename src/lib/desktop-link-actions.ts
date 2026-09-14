"use server";

import { headers } from "next/headers";
import { requireUser } from "./session";
import { approvePairingForUser, lookupPairingRequest } from "./desktop-pair";
import { isGeoMismatch, readGeo } from "./desktop-auth-core";
import { sendDeviceSignedInEmail } from "./email";
import { createLimiter } from "./rate-limit";

// Web-side approval of a desktop pairing code (/link page). Requires a full
// web session (requireUser redirects to /login otherwise); the claim is bound
// to THAT user id only. Rate-limited per user with SEPARATE budgets for code
// lookup (typos are common) and approve, so a few mistyped codes can't exhaust
// approval; both keep guessing impractical on top of the 40-bit code space.
// NOTE: limiter is per-instance memory — follow-up: shared store.
const lookupLimiter = createLimiter("device-pair-lookup", 20, 10 * 60 * 1000);
const approveLimiter = createLimiter("device-pair-approve", 10, 10 * 60 * 1000);
const RATE_MSG = "Too many attempts. Please wait a few minutes and try again.";

export type PairLookupView = {
  device: string;
  location: string;
  startedAt: string; // ISO
  geoMismatch: boolean;
  alreadyApprovedByYou: boolean;
};

async function approverCountry(): Promise<string | null> {
  try { return readGeo(await headers()).country; } catch { return null; }
}

export async function lookupDesktopPairing(code: string): Promise<{ ok: true; request: PairLookupView } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!(await lookupLimiter(user.id))) return { ok: false, error: RATE_MSG };
  const res = await lookupPairingRequest(user.id, code);
  if (!res.ok) return res;
  return {
    ok: true,
    request: {
      device: res.request.device,
      location: res.request.location,
      startedAt: res.request.createdAt.toISOString(),
      geoMismatch: isGeoMismatch(res.request.country, await approverCountry()),
      alreadyApprovedByYou: res.alreadyApprovedByYou,
    },
  };
}

export async function approveDesktopPairing(
  code: string,
  opts: { confirmedGeoMismatch?: boolean } = {},
): Promise<{ ok: true } | { ok: false; error: string; needsGeoConfirm?: boolean }> {
  const user = await requireUser();
  if (!(await approveLimiter(user.id))) return { ok: false, error: RATE_MSG };
  // Re-check the geo mismatch server-side: the extra confirm can't be skipped
  // by calling the action directly.
  const pre = await lookupPairingRequest(user.id, code);
  if (!pre.ok) return pre;
  if (isGeoMismatch(pre.request.country, await approverCountry()) && !opts.confirmedGeoMismatch) {
    return { ok: false, error: "This computer appears to be in a different country. Confirm below to continue.", needsGeoConfirm: true };
  }
  const res = await approvePairingForUser(user.id, code);
  if (!res.ok) return res;
  if (res.firstApproval) {
    try {
      const sent = await sendDeviceSignedInEmail(user.email, user.name, { device: res.request.device, location: res.request.location, when: new Date() });
      if (!sent.ok) console.warn("[desktop-link] sign-in notice not delivered:", sent.error);
    } catch (e) {
      console.warn("[desktop-link] sign-in notice failed:", e instanceof Error ? e.message : e);
    }
  }
  return { ok: true };
}
