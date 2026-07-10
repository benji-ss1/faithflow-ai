import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { listThemes } from "@/lib/server/theming";

export async function GET() {
  try {
    const user = await requireUser();
    const rows = await listThemes(user.churchId);
    return NextResponse.json({ themes: rows });
  } catch (e) {
    return NextResponse.json({ themes: [], error: e instanceof Error ? e.message : String(e) }, { status: 401 });
  }
}
