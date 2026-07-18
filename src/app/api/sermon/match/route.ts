// Phase 6: Sermon deck follow — transcript-to-slide matching.
// POST body: { pptxImportId, transcriptWindow, currentSlideIdx? }
// Strategy: (a) substring match of the transcript tail against slide/notes
// text (high confidence), (b) embedding cosine similarity fallback,
// (c) prefer slides at or after currentSlideIdx to avoid backward jumps.
import { NextResponse } from "next/server";
import { and, eq, asc, sql } from "drizzle-orm";
import { apiUser } from "@/lib/session";
import { getEntitlement, canUseAI } from "@/lib/server/entitlement";
import { getDb } from "@/lib/db/client";
import { pptxImports, pptxSlides } from "@/lib/db/schema";
import { embed, toVectorLiteral } from "@/lib/embeddings";

export const runtime = "nodejs";

type MatchHit = { slideIdx: number; confidence: number; matchedText: string };

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim();
}

function substringScore(slideText: string, tail: string): { score: number; matched: string } {
  const s = normalize(slideText);
  const t = normalize(tail);
  if (!s || !t) return { score: 0, matched: "" };
  // walk decreasing window sizes to find longest matching phrase
  const words = t.split(" ");
  const maxLen = Math.min(words.length, 12);
  for (let len = maxLen; len >= 3; len--) {
    for (let i = 0; i + len <= words.length; i++) {
      const phrase = words.slice(i, i + len).join(" ");
      if (phrase.length < 8) continue;
      if (s.includes(phrase)) {
        // confidence scales with phrase length
        const score = Math.min(98, 60 + len * 4);
        return { score, matched: phrase };
      }
    }
  }
  return { score: 0, matched: "" };
}

export async function POST(req: Request) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ent = await getEntitlement(user.churchId);
  if (!canUseAI(ent)) {
    return NextResponse.json({ error: "Sermon slide matching requires an active subscription" }, { status: 402 });
  }

  const body = await req.json().catch(() => ({}));
  const pptxImportId = String(body.pptxImportId || "");
  const transcriptWindow = String(body.transcriptWindow || "");
  const currentSlideIdx = typeof body.currentSlideIdx === "number" ? body.currentSlideIdx : 0;
  if (!pptxImportId) return NextResponse.json({ error: "pptxImportId required" }, { status: 400 });

  const db = getDb();
  const [imp] = await db.select().from(pptxImports)
    .where(and(eq(pptxImports.id, pptxImportId), eq(pptxImports.churchId, user.churchId)))
    .limit(1);
  if (!imp) return NextResponse.json({ error: "Import not found" }, { status: 404 });

  const slides = await db.select().from(pptxSlides)
    .where(eq(pptxSlides.pptxImportId, pptxImportId))
    .orderBy(asc(pptxSlides.order));
  if (slides.length === 0) return NextResponse.json({ current: null, next: null, source: "text" });

  // Tail of transcript — last ~40 words
  const tailWords = transcriptWindow.split(/\s+/).filter(Boolean).slice(-40);
  const tail = tailWords.join(" ");

  // Pass 1 — substring match on slide + notes text.
  const substringHits: MatchHit[] = [];
  for (const s of slides) {
    if (s.order < currentSlideIdx) continue; // prefer forward
    const combined = [s.slideText || "", s.notesText || ""].join(" ").trim();
    if (!combined) continue;
    const r = substringScore(combined, tail);
    if (r.score > 0) substringHits.push({ slideIdx: s.order, confidence: r.score, matchedText: r.matched });
  }
  substringHits.sort((a, b) => b.confidence - a.confidence || a.slideIdx - b.slideIdx);

  let source: "text" | "embedding" | "hybrid" = "text";
  let current: MatchHit | null = substringHits[0] ?? null;
  let next: MatchHit | null = null;

  // Pass 2 — embedding fallback if no strong substring hit.
  if (!current || current.confidence < 75) {
    if (tail.length >= 10) {
      try {
        const vec = await embed(tail);
        const lit = toVectorLiteral(vec);
        const rows = await db.execute(sql`
          SELECT "order" AS idx,
                 slide_text AS "slideText",
                 notes_text AS "notesText",
                 1 - (embedding <=> ${lit}::vector) AS sim
          FROM pptx_slides
          WHERE pptx_import_id = ${pptxImportId}
            AND embedding IS NOT NULL
            AND "order" >= ${currentSlideIdx}
          ORDER BY embedding <=> ${lit}::vector ASC
          LIMIT 3
        `);
        const embHits: MatchHit[] = (rows.rows as { idx: number; slideText: string | null; notesText: string | null; sim: number }[])
          .map((r) => ({
            slideIdx: r.idx,
            confidence: Math.round(Math.max(0, Math.min(1, r.sim)) * 100),
            matchedText: ((r.slideText || r.notesText || "").slice(0, 120)),
          }));
        if (embHits.length > 0) {
          if (!current) { current = embHits[0]; source = "embedding"; }
          else { source = "hybrid"; if (embHits[0].confidence > current.confidence) current = embHits[0]; }
          next = embHits[1] ?? null;
        }
      } catch (e) {
        console.warn("[sermon/match] embedding fallback failed:", e instanceof Error ? e.message : String(e));
      }
    }
  }

  // Compute "next likely" — first slide after current with any text
  if (!next && current) {
    const after = slides.find((s) => s.order > current!.slideIdx && ((s.slideText && s.slideText.length > 0) || (s.notesText && s.notesText.length > 0)));
    if (after) {
      const combined = [after.slideText || "", after.notesText || ""].join(" ").trim();
      next = { slideIdx: after.order, confidence: 40, matchedText: combined.slice(0, 120) };
    }
  }

  return NextResponse.json({ current, next, source });
}
