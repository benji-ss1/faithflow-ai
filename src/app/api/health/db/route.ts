import { NextResponse } from "next/server";
import { apiUser } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";

/**
 * Auth-gated on purpose. Unauthenticated callers get 401 with no infra hint.
 * Authenticated callers get a boolean and a generic reason on failure — the
 * real error is logged server-side, never returned to the client (would leak
 * DB host / db name / driver diagnostics).
 */
export async function GET() {
  const user = await apiUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const db = getDb();
    const rows = await db.execute(sql`SELECT 1 AS ping`);
    return NextResponse.json({ ok: (rows.rows?.[0] as { ping: number } | undefined)?.ping === 1, ts: Date.now() });
  } catch (e) {
    console.error("[health/db]", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: false, error: "Database unreachable" }, { status: 500 });
  }
}
