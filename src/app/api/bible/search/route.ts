import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { semanticSearch } from "@/lib/server/bible";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { translationId, query, limit } = body as { translationId?: string; query?: string; limit?: number };
  if (!translationId || !query || query.trim().length < 3) {
    return NextResponse.json({ error: "translationId and query (min 3 chars) required" }, { status: 400 });
  }
  try {
    const hits = await semanticSearch(translationId, query.trim(), Math.min(limit || 20, 50));
    return NextResponse.json({ hits });
  } catch (e) {
    console.error("semantic search error:", e);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
