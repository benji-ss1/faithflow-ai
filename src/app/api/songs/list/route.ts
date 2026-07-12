// Lightweight songs list for the operator LeftColumn Songs panel.
// Returns id/title/artist only — enough for the inline browser.
import { NextResponse } from "next/server";
import { apiUser } from "@/lib/session";
import { listSongs } from "@/lib/server/services";

export const runtime = "nodejs";

export async function GET() {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await listSongs(user.churchId);
  return NextResponse.json({
    songs: rows.map((r) => ({ id: r.id, title: r.title, artist: r.artist ?? null })),
  });
}
