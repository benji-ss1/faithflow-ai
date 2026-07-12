import { NextResponse } from "next/server";
import { apiUser } from "@/lib/session";
import { checkHealthRateLimit } from "@/lib/health-rate-limit";

export const runtime = "nodejs";

/**
 * Y8: presence-only Groq key check.
 *
 * The old diagnostics panel called the real /api/ai/helpers/improve_readability
 * endpoint on every refresh, which spent a Groq completion just to know
 * whether the key was set. This route replaces that with a cheap boolean:
 *   - `ok: true` when GROQ_API_KEY is set (non-empty).
 *   - `ok: false` with `code: "MISSING_API_KEY"` when unset — the panel
 *     surfaces this as a `warn` because Groq is a soft dependency (helpers
 *     gracefully disable without it, per CLAUDE.md #6).
 *
 * Auth-gated + rate-limited identically to the other /api/health/* routes.
 * Never returns key material or partial masks.
 */
export async function GET() {
  const user = await apiUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const limited = await checkHealthRateLimit(user.id);
  if (limited) return limited;
  const present = typeof process.env.GROQ_API_KEY === "string" && process.env.GROQ_API_KEY.length > 0;
  return NextResponse.json({
    ok: present,
    configured: present,
    code: present ? undefined : "MISSING_API_KEY",
    hint: present ? undefined : "Set GROQ_API_KEY on Vercel. AI helpers gracefully disable without it.",
    ts: Date.now(),
  });
}
