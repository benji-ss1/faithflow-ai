import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { apiRequireRole } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";

export const runtime = "nodejs";

export async function GET() {
  // Any authenticated church member can read the CCLI number.
  const user = await apiRequireRole("admin", "operator", "volunteer", "pastor", "viewer");
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const [row] = await db
    .select({ ccliNumber: settings.ccliNumber })
    .from(settings)
    .where(eq(settings.churchId, user.churchId))
    .limit(1);

  return NextResponse.json({ ccliNumber: row?.ccliNumber ?? null });
}

export async function POST(req: Request) {
  // Only admins may change the church's CCLI number.
  const user = await apiRequireRole("admin");
  if (!user) return NextResponse.json({ error: "Forbidden — admin role required" }, { status: 403 });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const ccliNumber = typeof body.ccliNumber === "string" ? body.ccliNumber.trim() : null;

  // Validate: CCLI numbers are numeric strings, typically 5-8 digits.
  if (ccliNumber !== null && ccliNumber !== "" && !/^\d{1,10}$/.test(ccliNumber)) {
    return NextResponse.json({ error: "CCLI number must be numeric" }, { status: 400 });
  }

  const db = getDb();

  // Upsert: settings row may or may not exist yet.
  const existing = await db
    .select({ id: settings.id })
    .from(settings)
    .where(eq(settings.churchId, user.churchId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(settings)
      .set({ ccliNumber: ccliNumber || null, updatedAt: new Date() })
      .where(eq(settings.churchId, user.churchId));
  } else {
    await db
      .insert(settings)
      .values({ churchId: user.churchId, ccliNumber: ccliNumber || null });
  }

  return NextResponse.json({ ok: true, ccliNumber: ccliNumber || null });
}
