// Lightweight songs list for the operator LeftColumn Songs panel.
// Returns id/title/artist only — enough for the inline browser.
import { NextResponse } from "next/server";
import { apiUser } from "@/lib/session";
import { listSongs } from "@/lib/server/services";

export const runtime = "nodejs";

// A named library id must be a UUID (Y2) — reject anything else with a 400 so a
// malformed/hostile ?library= can never reach the query as an opaque string.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // ProPresenter parity: ?library=all (default) | default (unfiled) | <uuid>.
  const lib = new URL(req.url).searchParams.get("library");
  if (lib != null && lib !== "all" && lib !== "default" && !UUID_RE.test(lib)) {
    return NextResponse.json({ error: "Invalid library id" }, { status: 400 });
  }
  const filter = lib == null || lib === "all" ? undefined : lib === "default" ? null : lib;
  const rows = await listSongs(user.churchId, filter);
  return NextResponse.json({
    songs: rows.map((r) => ({ id: r.id, title: r.title, artist: r.artist ?? null })),
  });
}
