/**
 * Internal semantic-search endpoint for the Fly audio bridge (roadmap B,
 * 2026-07-24). Same underlying `semanticSearch()` as the user-facing
 * /api/bible/search route, but auth'd via a shared bearer secret instead
 * of a user session — the bridge has no user cookie.
 *
 * Why this exists: the Fly container's `sharp` install is broken, so
 * `@xenova/transformers` (needed by semanticSearch → embedding gen) fails
 * to load. Rather than fight Docker builds, we do semantic search on
 * Vercel where sharp works, and the bridge just POSTs the transcript
 * text to us.
 *
 * Security:
 *   - Bearer token from INTERNAL_API_SECRET env var (rotate + share to
 *     both Vercel and Fly). No user auth path, no cookie.
 *   - Rate-limited per-IP: 300/min. Bridge normally makes ~1 call per
 *     low-confidence detection = a handful per service.
 *   - Body is server-authoritative for the returned rows — bridge cannot
 *     inject wrong verse text or bypass church_id (semanticSearch queries
 *     the shared bible corpus, not any per-church data).
 */
import { NextResponse } from "next/server";
import { createLimiter } from "@/lib/rate-limit";
import { semanticSearch, listTranslations } from "@/lib/server/bible";

export const runtime = "nodejs";
export const maxDuration = 15;

const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || "";
const limiter = createLimiter("internal-semantic-search", 300, 60_000);

function unauthorized(reason: string) {
  return NextResponse.json({ error: `unauthorized: ${reason}` }, { status: 401 });
}

export async function POST(req: Request) {
  if (!INTERNAL_SECRET) {
    return NextResponse.json({ error: "server misconfigured: no internal secret" }, { status: 500 });
  }
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ") || auth.slice(7) !== INTERNAL_SECRET) {
    return unauthorized("bad bearer");
  }

  // IP-based rate limiter — bridge should never come close to this.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const allowed = await limiter(ip);
  if (!allowed) return NextResponse.json({ error: "rate limited" }, { status: 429 });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const query = typeof body.query === "string" ? body.query.trim() : "";
  const translationId = typeof body.translationId === "string" ? body.translationId : "";
  const translationCode = typeof body.translationCode === "string" ? body.translationCode : "KJV";
  const limitRaw = typeof body.limit === "number" ? body.limit : 3;
  const limit = Math.max(1, Math.min(20, Math.floor(limitRaw)));

  if (query.length < 6) {
    // Match src/lib/server/bible.ts semantic-search min gate — anything
    // shorter is too noisy to be worth an embedding round-trip.
    return NextResponse.json({ hits: [] });
  }

  // Bridge passes translationId (UUID from churchPreferences) most of the
  // time; UI clients pass code. Accept either.
  const translations = await listTranslations();
  const t = translationId
    ? translations.find((x) => x.id === translationId)
    : translations.find((x) => x.code === translationCode) || translations[0];
  if (!t) return NextResponse.json({ error: "no translation available" }, { status: 500 });

  try {
    const hits = await semanticSearch(t.id, query, limit);
    return NextResponse.json({ hits, translation: t.code });
  } catch (e) {
    console.error("[internal-semantic-search] failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "semantic search failed" }, { status: 500 });
  }
}
