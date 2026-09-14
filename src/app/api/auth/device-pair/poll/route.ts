import { NextRequest, NextResponse } from "next/server";
import { pollPairing } from "@/lib/desktop-pair";
import { verifyPairTicket } from "@/lib/desktop-auth-core";
import { createLimiter } from "@/lib/rate-limit";
import { clientIpFromHeaders } from "@/lib/login-guard";

// Desktop polls every ~3s for up to 10 min (≈200 calls). Per-ticket cap stops
// hammering one ticket; per-IP cap is generous because a church network shares
// one IP across several computers. Forged tickets fail HMAC before any DB work.
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
  const res = await pollPairing(body.ticket);
  const status = res.status === "invalid" ? 400 : 200;
  return NextResponse.json(res, { status, headers: { "Cache-Control": "no-store" } });
}
