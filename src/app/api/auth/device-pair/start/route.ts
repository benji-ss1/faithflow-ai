import { NextRequest, NextResponse } from "next/server";
import { startPairing } from "@/lib/desktop-pair";
import { createLimiter } from "@/lib/rate-limit";
import { clientIpFromHeaders } from "@/lib/login-guard";

// Unauthenticated by design (the desktop has no session yet). Creates NO DB
// row — returns a random code + a signed ticket only. Rate-limited per IP.
// NOTE: limiter is per-instance memory (see rate-limit.ts).
const startLimiter = createLimiter("device-pair-start", 30, 10 * 60 * 1000);

export async function POST(req: NextRequest) {
  const ip = clientIpFromHeaders(req.headers);
  if (!(await startLimiter(ip))) {
    return NextResponse.json({ error: "Too many attempts. Please wait a few minutes." }, { status: 429 });
  }
  const p = startPairing();
  return NextResponse.json(
    { code: p.displayCode, ticket: p.ticket, expiresAt: p.expiresAt },
    { headers: { "Cache-Control": "no-store" } },
  );
}
