// Sermon summarization. Reads finalized transcript_segments + detected_references
// for a service plan, calls the LLM once with a structured JSON schema, and
// upserts a sermon_summaries row (also embedded for RAG in Layer E).

import { asc, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { transcriptSegments, detectedReferences, sermonSummaries, servicePlans } from "../db/schema";
import { chatComplete } from "../llm";
import { embed, toVectorLiteral } from "../embeddings";
import { sql } from "drizzle-orm";

type Scripture = { book: string; chapter: number; verseStart: number; verseEnd: number };
export type SermonSummaryData = {
  title: string;
  overview: string;
  keyPoints: string[];
  scriptureList: Scripture[];
  notableQuotes: string[];
  actionPoints: string[];
  wordCount: number;
  model: string;
};

const SYSTEM_PROMPT = `You are a careful sermon note-taker for a church presentation
system. Given a raw sermon transcript and a list of Bible references that were
detected during the service, produce a concise, honest summary. Do NOT invent
quotes or references. If the transcript is very short or unclear, say so in
the overview rather than fabricating content.

Return ONLY valid JSON matching this shape:
{
  "title": "short descriptive title (max 8 words, no quotes)",
  "overview": "2-4 sentence summary of the sermon",
  "keyPoints": ["3-6 bullet points of the main teaching"],
  "notableQuotes": ["1-3 short verbatim quotes from the transcript, exact wording"],
  "actionPoints": ["1-4 short action items or challenges the pastor gave"]
}
Do not include the scripture list — it will be added from an authoritative source.`;

export async function generateSermonSummary(planId: string): Promise<SermonSummaryData> {
  const db = getDb();

  const segments = await db.select().from(transcriptSegments)
    .where(eq(transcriptSegments.servicePlanId, planId))
    .orderBy(asc(transcriptSegments.ts));
  const fullText = segments.map((s) => s.text).join(" ").trim();
  if (!fullText || fullText.length < 40) {
    // Not enough content — return a placeholder rather than call the LLM
    return {
      title: "Untitled sermon",
      overview: "Transcript was too short to summarize automatically.",
      keyPoints: [],
      scriptureList: [],
      notableQuotes: [],
      actionPoints: [],
      wordCount: fullText.split(/\s+/).filter(Boolean).length,
      model: "n/a (short-circuit)",
    };
  }

  // Authoritative scripture list — from real detected references only.
  const refs = await db.execute(sql`
    SELECT dr.book, dr.chapter, dr.verse_start AS "verseStart", dr.verse_end AS "verseEnd"
    FROM detected_references dr
    JOIN transcript_segments ts ON ts.id = dr.transcript_segment_id
    WHERE ts.service_plan_id = ${planId}
      AND dr.status IN ('approved', 'pending')
    GROUP BY dr.book, dr.chapter, dr.verse_start, dr.verse_end
    ORDER BY dr.book, dr.chapter, dr.verse_start
  `);
  const scriptureList = (refs.rows as Scripture[]);

  // Chunk defensively — grok-2 handles long context but there's no reason
  // to send 100k tokens if we can send 20k. Truncate to ~60k chars of the
  // most informative middle section.
  const MAX = 60000;
  const inputText = fullText.length > MAX
    ? fullText.slice(0, Math.floor(MAX * 0.4)) + "\n[...transcript truncated for length...]\n" + fullText.slice(-Math.floor(MAX * 0.4))
    : fullText;

  const raw = await chatComplete({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Detected scripture references (context only, do not repeat verbatim):\n${scriptureList.map((r) => `${r.book} ${r.chapter}:${r.verseStart}${r.verseStart !== r.verseEnd ? `-${r.verseEnd}` : ""}`).join(", ") || "(none)"}` },
      { role: "user", content: `Transcript:\n\n${inputText}` },
    ],
    responseFormat: "json_object",
    temperature: 0.2,
    maxTokens: 1500,
  });

  let parsed: Omit<SermonSummaryData, "scriptureList" | "wordCount" | "model">;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Recover: use whole response as overview
    parsed = { title: "Untitled sermon", overview: raw.slice(0, 800), keyPoints: [], notableQuotes: [], actionPoints: [] };
  }

  return {
    title: (parsed.title || "Untitled sermon").slice(0, 120),
    overview: parsed.overview || "",
    keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.slice(0, 10) : [],
    scriptureList,
    notableQuotes: Array.isArray(parsed.notableQuotes) ? parsed.notableQuotes.slice(0, 5) : [],
    actionPoints: Array.isArray(parsed.actionPoints) ? parsed.actionPoints.slice(0, 6) : [],
    wordCount: fullText.split(/\s+/).filter(Boolean).length,
    model: process.env.XAI_MODEL || "grok-2-latest",
  };
}

export async function upsertSermonSummary(planId: string, data: SermonSummaryData): Promise<{ id: string }> {
  const db = getDb();
  // Embedding: overview + key points + action points concatenated. Provides
  // a solid semantic anchor for RAG search over past sermons.
  const embedText = [
    data.title,
    data.overview,
    ...(data.keyPoints || []),
    ...(data.actionPoints || []),
  ].join("\n\n").trim();
  const vec = embedText ? await embed(embedText) : null;

  const [existing] = await db.select({ id: sermonSummaries.id }).from(sermonSummaries).where(eq(sermonSummaries.servicePlanId, planId)).limit(1);

  const values = {
    title: data.title,
    overview: data.overview,
    keyPoints: data.keyPoints,
    scriptureList: data.scriptureList,
    notableQuotes: data.notableQuotes,
    actionPoints: data.actionPoints,
    wordCount: data.wordCount,
    generatedAt: new Date(),
    model: data.model,
  };

  let id: string;
  if (existing) {
    await db.update(sermonSummaries).set(values).where(eq(sermonSummaries.id, existing.id));
    id = existing.id;
  } else {
    const [row] = await db.insert(sermonSummaries).values({ servicePlanId: planId, ...values }).returning({ id: sermonSummaries.id });
    id = row.id;
  }

  if (vec) {
    await db.execute(sql.raw(`UPDATE sermon_summaries SET embedding = '${toVectorLiteral(vec)}'::vector WHERE id = '${id}'`));
  }
  return { id };
}

export async function listSermonSummaries(churchId: string, opts: { keyword?: string } = {}) {
  const db = getDb();
  if (opts.keyword && opts.keyword.trim()) {
    const pattern = `%${opts.keyword.trim().toLowerCase()}%`;
    return (await db.execute(sql`
      SELECT ss.id, ss.title, ss.overview, ss.generated_at AS "generatedAt", ss.scripture_list AS "scriptureList",
             sp.id AS "planId", sp.title AS "planTitle"
      FROM sermon_summaries ss
      JOIN service_plans sp ON sp.id = ss.service_plan_id
      WHERE sp.church_id = ${churchId}
        AND (LOWER(ss.title) LIKE ${pattern} OR LOWER(ss.overview) LIKE ${pattern})
      ORDER BY ss.generated_at DESC
    `)).rows;
  }
  return (await db.execute(sql`
    SELECT ss.id, ss.title, ss.overview, ss.generated_at AS "generatedAt", ss.scripture_list AS "scriptureList",
           sp.id AS "planId", sp.title AS "planTitle"
    FROM sermon_summaries ss
    JOIN service_plans sp ON sp.id = ss.service_plan_id
    WHERE sp.church_id = ${churchId}
    ORDER BY ss.generated_at DESC
  `)).rows;
}

export async function getSermonSummary(churchId: string, id: string) {
  const db = getDb();
  const [row] = (await db.execute(sql`
    SELECT ss.*, sp.id AS "planId", sp.title AS "planTitle"
    FROM sermon_summaries ss
    JOIN service_plans sp ON sp.id = ss.service_plan_id
    WHERE ss.id = ${id} AND sp.church_id = ${churchId}
  `)).rows as ({ id: string; title: string; overview: string; key_points: string[]; scripture_list: Scripture[]; notable_quotes: string[]; action_points: string[]; word_count: number; generated_at: Date; model: string | null; planId: string; planTitle: string })[];
  return row || null;
}

export async function semanticSermonSearch(churchId: string, query: string, limit = 10) {
  const db = getDb();
  const vec = await embed(query);
  const lit = toVectorLiteral(vec);
  return (await db.execute(sql`
    SELECT ss.id, ss.title, ss.overview, ss.generated_at AS "generatedAt", ss.scripture_list AS "scriptureList",
           sp.id AS "planId", sp.title AS "planTitle",
           (ss.embedding <=> ${lit}::vector) AS distance
    FROM sermon_summaries ss
    JOIN service_plans sp ON sp.id = ss.service_plan_id
    WHERE sp.church_id = ${churchId} AND ss.embedding IS NOT NULL
    ORDER BY ss.embedding <=> ${lit}::vector
    LIMIT ${limit}
  `)).rows;
}
