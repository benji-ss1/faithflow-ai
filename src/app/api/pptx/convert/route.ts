import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { apiUser } from "@/lib/session";
import { getEntitlement, canUseAI } from "@/lib/server/entitlement";
import { createLimiter } from "@/lib/rate-limit";
import { getDb } from "@/lib/db/client";
import { pptxImports } from "@/lib/db/schema";
import { convertPptxImport } from "@/lib/pptx";

// LibreOffice conversion is CPU-heavy (300s max). Cap per church to prevent
// a compromised session from grinding Vercel function-seconds. 20/day is
// generous for weekly service prep — real operators convert once per PPTX.
const convertLimiter = createLimiter("pptx-convert", 20, 24 * 60 * 60 * 1000);

export const runtime = "nodejs";
export const maxDuration = 300;

const CONVERSION_TIMEOUT_MS = 4 * 60 * 1000; // 4 minutes

export async function POST(req: Request) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Session expired — please sign in again" }, { status: 401 });
  const ent = await getEntitlement(user.churchId);
  if (!canUseAI(ent)) {
    return NextResponse.json({ error: "PPTX conversion requires an active subscription" }, { status: 402 });
  }
  if (!(await convertLimiter(user.churchId))) {
    return NextResponse.json({ error: "Daily PPTX conversion limit reached — try again tomorrow" }, { status: 429 });
  }

  const { importId } = await req.json().catch(() => ({}));
  if (!importId) return NextResponse.json({ error: "importId required" }, { status: 400 });

  const db = getDb();
  const [row] = await db.select().from(pptxImports)
    .where(and(eq(pptxImports.id, String(importId)), eq(pptxImports.churchId, user.churchId)))
    .limit(1);
  if (!row) return NextResponse.json({ error: "Import not found" }, { status: 404 });

  // Allow retry: reset any prior `failed` state so the sweeper doesn't
  // preempt it, and clear the old error message.
  if (row.status === "failed") {
    await db.update(pptxImports)
      .set({ status: "pending", errorMessage: null })
      .where(eq(pptxImports.id, row.id));
  }

  // Sweep any stale "pending" rows for this church before we start. If the
  // dev server got restarted mid-conversion, they'd otherwise sit forever.
  await db.execute(sql`
    UPDATE pptx_imports
    SET status = 'failed', error_message = 'Server was restarted while converting. Re-upload to try again.'
    WHERE church_id = ${user.churchId}
      AND status IN ('pending', 'converting')
      AND created_at < NOW() - INTERVAL '10 minutes'
  `);

  // Await conversion synchronously with a hard timeout. Previous fire-and-forget
  // pattern left rows at `pending` when the server restarted before the promise
  // resolved — the browser had already navigated away, no error visible.
  const timeoutPromise = new Promise<never>((_, rej) =>
    setTimeout(() => rej(new Error(`Conversion timed out after ${CONVERSION_TIMEOUT_MS / 1000}s`)), CONVERSION_TIMEOUT_MS)
  );

  try {
    await Promise.race([convertPptxImport(row.id), timeoutPromise]);
    return NextResponse.json({ ok: true, status: "ready" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Conversion failed";
    // Force-set failed status in case convertPptxImport didn't get there
    await db.update(pptxImports)
      .set({ status: "failed", errorMessage: msg })
      .where(eq(pptxImports.id, row.id));
    return NextResponse.json({ ok: false, status: "failed", error: msg }, { status: 500 });
  }
}
