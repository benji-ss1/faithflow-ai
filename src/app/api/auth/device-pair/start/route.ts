import { NextRequest, NextResponse } from "next/server";
import { startPairing } from "@/lib/desktop-pair";
import { readGeo } from "@/lib/desktop-auth-core";
import { createLimiter } from "@/lib/rate-limit";
import { clientIpFromHeaders } from "@/lib/login-guard";

// Unauthenticated by design (the desktop has no session yet). Records a
// short-lived device_pair_requests row (code HMAC, IP, UA, Vercel geo) so the
// approver on /link can see which device is asking. Rate-limited per IP.
// NOTE: limiter is per-instance memory (see rate-limit.ts) — follow-up: shared store.
const startLimiter = createLimiter("device-pair-start", 30, 10 * 60 * 1000);

export async function POST(req: NextRequest) {
  const ip = clientIpFromHeaders(req.headers);
  if (!(await startLimiter(ip))) {
    return NextResponse.json({ error: "Too many attempts. Please wait a few minutes." }, { status: 429 });
  }
  try {
    const p = await startPairing({ ip, userAgent: req.headers.get("user-agent"), ...readGeo(req.headers) });
    return NextResponse.json(
      { code: p.displayCode, ticket: p.ticket, expiresAt: p.expiresAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("[device-pair/start] failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Couldn't start. Please try again." }, { status: 503 });
  }
}
