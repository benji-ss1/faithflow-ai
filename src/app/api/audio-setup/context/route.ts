// GET  /api/audio-setup/context  → Sarah's starting context for this church:
//      the best-matching beta application (setup fields only when an identity
//      signal ties it to this church) and the saved church audio profile.
// POST /api/audio-setup/context  → save the (corrected) audio profile.
//      Requires the operate_services capability (viewers/pastors can't overwrite it).
//
// Church + user come from the session only. Nothing client-supplied selects a church.
import { NextResponse } from "next/server";
import { apiUser, hasCap } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { loadSetupContextCore, saveAudioProfileCore } from "@/lib/server/audio-setup";

export const runtime = "nodejs";

export async function GET() {
  const user = await apiUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const ctx = await loadSetupContextCore(getDb(), user);
    return NextResponse.json({ ok: true, data: ctx }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[audio-setup] context failed", e);
    // Degrade to "start fresh" rather than blocking setup.
    return NextResponse.json({ ok: true, data: { match: null, profile: {}, profileAvailable: false } });
  }
}

export async function POST(req: Request) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!hasCap(user.role, "operate_services")) {
    return NextResponse.json({ ok: false, error: "Your role can't change the church's audio setup" }, { status: 403 });
  }
  const text = await req.text().catch(() => "");
  if (text.length > 64_000) return NextResponse.json({ ok: false, error: "Too large" }, { status: 413 });
  let body: Record<string, unknown> = {};
  try { const j = JSON.parse(text || "{}"); if (j && typeof j === "object") body = j as Record<string, unknown>; } catch { /* empty */ }
  const appId = typeof body.confirmedApplicationId === "string" ? body.confirmedApplicationId : null;
  try {
    const res = await saveAudioProfileCore(getDb(), user, body.profile, appId);
    return NextResponse.json(res, { status: res.ok ? 200 : 503 });
  } catch (e) {
    console.error("[audio-setup] save failed", e);
    return NextResponse.json({ ok: false, error: "Couldn't save your audio profile" }, { status: 500 });
  }
}
