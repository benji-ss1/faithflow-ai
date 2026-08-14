import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { listThemes, refreshThemeMediaUrls } from "@/lib/server/theming";

export async function GET() {
  try {
    const user = await requireUser();
    const rows = await listThemes(user.churchId);
    // Re-sign expiring media URLs so a theme's background/logo never 404s after
    // the original 6h presign lapses (operator loads themes from here).
    const themesOut = await Promise.all(rows.map(async (r) => ({ ...r, config: await refreshThemeMediaUrls(r.config) })));
    return NextResponse.json({ themes: themesOut });
  } catch (e) {
    return NextResponse.json({ themes: [], error: e instanceof Error ? e.message : String(e) }, { status: 401 });
  }
}
