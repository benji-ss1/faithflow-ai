import { NextResponse } from "next/server";
import { apiUser } from "@/lib/session";
import { checkHealthRateLimit } from "@/lib/health-rate-limit";

export const runtime = "nodejs";

/**
 * Presence-only check for the Deepgram API key. Never returns the key value.
 * Auth-gated to avoid probing / signaling infra state to anonymous callers.
 *
 * The Deepgram key lives on the Fly.io audio bridge in production; this
 * endpoint checks the Next.js server process's own env so the diagnostics
 * panel can flag "no key configured here" during local dev / desktop
 * launcher runs. A green result means the env var is set on THIS process,
 * not that Deepgram itself is reachable — that's the audio-bridge WS probe's
 * job.
 */
export async function GET() {
  const user = await apiUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const limited = await checkHealthRateLimit(user.id);
  if (limited) return limited;
  const present = typeof process.env.DEEPGRAM_API_KEY === "string" && process.env.DEEPGRAM_API_KEY.length > 0;
  return NextResponse.json({
    ok: present,
    configured: present,
    hint: present ? undefined : "Set DEEPGRAM_API_KEY on the Fly.io audio bridge (and locally in .env.local if you run the bridge yourself).",
    ts: Date.now(),
  });
}
