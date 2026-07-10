import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { listAnnouncementPresets } from "@/lib/server/theming";

export async function GET() {
  try {
    const user = await requireUser();
    const rows = await listAnnouncementPresets(user.churchId);
    return NextResponse.json({ presets: rows });
  } catch (e) {
    return NextResponse.json({ presets: [], error: e instanceof Error ? e.message : String(e) }, { status: 401 });
  }
}
