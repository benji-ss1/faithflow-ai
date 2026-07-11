import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";

export async function GET() {
  try {
    const db = getDb();
    const rows = await db.execute(sql`SELECT 1 AS ping`);
    return NextResponse.json({ ok: (rows.rows?.[0] as { ping: number } | undefined)?.ping === 1, ts: Date.now() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "unknown" }, { status: 500 });
  }
}
