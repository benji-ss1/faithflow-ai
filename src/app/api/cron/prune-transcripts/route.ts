import { NextResponse } from "next/server";
import { pruneTranscripts } from "@/lib/server/transcript-retention";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 401 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await pruneTranscripts();
    return NextResponse.json({ ok: result.errors.length === 0, ...result }, { status: result.errors.length ? 500 : 200 });
  } catch (error) {
    console.error("prune-transcripts cron error:", error);
    return NextResponse.json({ ok: false, error: "prune failed" }, { status: 500 });
  }
}
