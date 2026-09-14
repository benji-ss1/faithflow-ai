import { NextRequest, NextResponse } from "next/server";
import { pollPairing } from "@/lib/desktop-pair";
import { PAIR_MARKER_COOKIE, signPairExchangeMarker, verifyPairTicket } from "@/lib/desktop-auth-core";
import { PAIR_EXCHANGE_TTL_MS } from "@/lib/desktop-pair";
import { createLimiter } from "@/lib/rate-limit";
import { clientIpFromHeaders } from "@/lib/login-guard";

// Desktop polls every ~3s for up to 10 min (≈200 calls). Per-ticket cap stops
// hammering one ticket; per-IP cap is generous because a church network shares
// one IP across several computers. Forged tickets fail HMAC before any DB work.
// NOTE: limiters are per-instance memory — follow-up: shared store.
const ticketLimiter = createLimiter("device-pair-poll-ticket", 300, 10 * 60 * 1000);
const ipLimiter = createLimiter("device-pair-poll-ip", 2000, 10 * 60 * 1000);

export async function POST(req: NextRequest) {
  const ip = clientIpFromHeaders(req.headers);
  if (!(await ipLimiter(ip))) return NextResponse.json({ status: "rate_limited" }, { status: 429 });
  let body: { ticket?: unknown } = {};
  try { body = await req.json(); } catch { /* invalid below */ }
  const t = verifyPairTicket(body.ticket);
  if (!t) return NextResponse.json({ status: "invalid" }, { status: 400 });
  if (!(await ticketLimiter(t.nonce))) return NextResponse.json({ status: "rate_limited" }, { status: 429 });
  let res;
  try {
    res = await pollPairing(body.ticket);
  } catch (e) {
    console.error("[device-pair/poll] failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ status: "error" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const status = res.status === "invalid" ? 400 : res.status === "expired" ? 410 : res.status === "error" ? 503 : 200;
  const out = NextResponse.json(res, { status, headers: { "Cache-Control": "no-store" } });
  if (res.status === "approved") {
    // Marker bound to THIS exchange token, in THIS window's cookie jar: lets
    // device-exchange skip the "Sign in as …?" confirm only for the window
    // that actually completed pairing (not a forwarded exchange URL).
    out.cookies.set(PAIR_MARKER_COOKIE, signPairExchangeMarker(res.token), {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/api/auth/device-exchange",
      maxAge: Math.ceil(PAIR_EXCHANGE_TTL_MS / 1000),
    });
  }
  return out;
}
