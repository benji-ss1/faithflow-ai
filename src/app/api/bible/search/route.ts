import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { semanticSearch, listTranslations } from "@/lib/server/bible";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/bible/search
 * Body: { query?: string | q?: string; translation?: string (code) | translationId?: string; limit?: number }
 *
 * Historically this endpoint required `translationId` (UUID). The BibleMode
 * client only knows the translation code (e.g. "KJV"). Accept both, resolve
 * code → id server-side so the client stays simple. Enforces min-3-char
 * query per pgvector cost — the client also gates client-side.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const {
    translationId: bodyTranslationId,
    translation,
    query,
    q,
    limit,
  } = body as { translationId?: string; translation?: string; query?: string; q?: string; limit?: number };

  const finalQuery = (query ?? q ?? "").trim();
  if (!finalQuery || finalQuery.length < 3) {
    return NextResponse.json({ error: "query (min 3 chars) required" }, { status: 400 });
  }

  let translationId = bodyTranslationId;
  let translationCode = "";
  if (!translationId) {
    const translations = await listTranslations();
    const t = translation
      ? translations.find((x) => x.code === translation)
      : translations.find((x) => x.code === "KJV") || translations[0];
    if (!t) return NextResponse.json({ error: "No translation available" }, { status: 500 });
    translationId = t.id;
    translationCode = t.code;
  }

  try {
    // Cap at 100 — the client Results limit dropdown offers 10/20/50/100 and
    // the operator can raise it when they want more context. Above 100 the
    // pgvector query cost climbs sharply for diminishing UX value.
    const requested = typeof limit === "number" && limit > 0 ? limit : 20;
    const hits = await semanticSearch(translationId, finalQuery, Math.min(requested, 100));
    // Backwards-compat: expose both `hits` and `results` so older callers
    // that read `res.results` keep working.
    return NextResponse.json({ hits, results: hits, translation: translationCode });
  } catch (e) {
    console.error("semantic search error:", e);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
