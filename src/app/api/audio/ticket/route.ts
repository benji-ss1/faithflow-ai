import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { apiUser } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { servicePlans } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Session expired — please sign in again" }, { status: 401 });

  const { planId } = await req.json().catch(() => ({}));
  if (!planId || typeof planId !== "string") return NextResponse.json({ error: "planId required" }, { status: 400 });

  // Y5: verify plan ownership at mint. Prevents cross-church ticket forging
  // by an authenticated user targeting another church's planId.
  const db = getDb();
  const [plan] = await db
    .select({ id: servicePlans.id })
    .from(servicePlans)
    .where(and(eq(servicePlans.id, planId), eq(servicePlans.churchId, user.churchId)))
    .limit(1);
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 403 });

  const exp = Date.now() + 5 * 60 * 1000; // 5 min
  // Y5: bind userId into the HMAC payload so a leaked ticket can't be
  // replayed under a different session.
  const sig = crypto.createHmac("sha256", process.env.AUTH_SECRET!)
    .update(`${planId}|${user.churchId}|${user.id}|${exp}`)
    .digest("hex");

  // Hard-fail in prod when NEXT_PUBLIC_AUDIO_WS_URL is missing OR points at
  // plain ws:// (mixed-content — browsers on https:// silently block it and
  // Fly never sees a connection attempt). Localhost dev is still allowed via
  // ws://. This is what was making the AI Live pill die silently for testers
  // before — the URL got returned, WS constructor threw or failed silently,
  // pill stayed "connecting…", zero Fly logs.
  const wsBase = process.env.NEXT_PUBLIC_AUDIO_WS_URL || "ws://localhost:3001";
  // Parse via URL constructor rather than regex — regex on origin-shaped
  // strings can be fooled by userinfo (`ws://localhost@evil.com/`) or
  // suffix collisions (`ws://LOCALHOST.evil.com/`).
  let wsUrl: URL;
  try {
    wsUrl = new URL(wsBase);
  } catch {
    return NextResponse.json(
      { error: "Audio bridge misconfigured — NEXT_PUBLIC_AUDIO_WS_URL is not a valid URL" },
      { status: 503 },
    );
  }
  if (wsUrl.protocol !== "ws:" && wsUrl.protocol !== "wss:") {
    return NextResponse.json({ error: "Audio bridge misconfigured — protocol must be ws:/wss:" }, { status: 503 });
  }
  const isLocalhost = wsUrl.hostname === "localhost" || wsUrl.hostname === "127.0.0.1";
  const isSecure = wsUrl.protocol === "wss:";
  const isProdOrigin = new URL(req.url).protocol === "https:";
  if (isProdOrigin && !isSecure && !isLocalhost) {
    console.error(`[audio/ticket] refusing ticket — NEXT_PUBLIC_AUDIO_WS_URL insecure: ${wsUrl.origin}`);
    return NextResponse.json(
      { error: "Audio bridge not configured — set NEXT_PUBLIC_AUDIO_WS_URL to wss://<fly-app>.fly.dev" },
      { status: 503 },
    );
  }
  const url = `${wsBase}?planId=${planId}&churchId=${user.churchId}&userId=${user.id}&exp=${exp}&sig=${sig}`;
  return NextResponse.json({ url });
}
