import { NextResponse } from "next/server";
import { apiUser } from "@/lib/session";
import { lookupReference, lookupReferenceWithWindow, listTranslations } from "@/lib/server/bible";
import { cacheKey, getCached, setCached, warmCache } from "@/lib/server/bible-cache";
import { createLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";

// Y13: per-user rate limit. In-memory (per Next server instance);
// replace with Redis-backed limiter in prod.
// Split manual vs AI-triggered lookups into separate budgets: AI auto-detection
// fires cachedLookup on every fresh high-confidence suggestion during a sermon
// (frequent, small, automatic), which was burning through one shared 60/min
// budget and starving deliberate manual lookups (rare, intentional) — a burst
// of detections could 429 a manual "Lookup" click moments later. AI gets a
// higher ceiling since each call is cheap and bounded by detection cadence.
const lookupLimiterManual = createLimiter("bible-lookup-manual", 60, 60 * 1000);
const lookupLimiterAI = createLimiter("bible-lookup-ai", 120, 60 * 1000);

// Fire-and-forget cache warm on module load. Won't block cold requests.
void warmCache();

export async function POST(req: Request) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { book, chapter, verseStart, verseEnd, chapterEnd, translationCode, withWindow, source } = await req.json().catch(() => ({}));

  const limiter = source === "ai" ? lookupLimiterAI : lookupLimiterManual;
  const ok = await limiter(user.id);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  // Y14: cap + sanitize book input.
  if (typeof book !== "string" || book.length === 0 || book.length > 64 || /[\x00-\x1F]/.test(book)) {
    return NextResponse.json({ error: "invalid book" }, { status: 400 });
  }
  if (!chapter || !verseStart || !verseEnd) return NextResponse.json({ error: "Missing params" }, { status: 400 });

  const translations = await listTranslations();
  const t = translationCode ? translations.find((x) => x.code === translationCode) : translations.find((x) => x.code === "KJV") || translations[0];
  if (!t) return NextResponse.json({ error: "No translation available" }, { status: 500 });

  if (withWindow) {
    const { primary, before, after } = await lookupReferenceWithWindow(
      t.id, book, Number(chapter), Number(verseStart), Number(verseEnd), 5,
    );
    return NextResponse.json({ translation: t.code, primary, before, after, verses: primary });
  }

  // Cache lookup path: single roundtrip for the whole range (including cross-chapter).
  const chEnd = chapterEnd ? Number(chapterEnd) : undefined;
  const key = cacheKey(t.code, book, Number(chapter), Number(verseStart), Number(verseEnd), chEnd);
  const hit = getCached(key);
  if (hit) return NextResponse.json({ translation: t.code, verses: hit, cached: true });

  const verses = await lookupReference(t.id, book, Number(chapter), Number(verseStart), Number(verseEnd), chEnd);
  if (verses.length > 0) setCached(key, verses);
  return NextResponse.json({ translation: t.code, verses });
}
