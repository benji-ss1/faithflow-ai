// Fine-grained, chunk-level RAG over a service's raw transcript. Distinct
// from sermon-summary.ts (one embedded high-level summary per service) —
// this indexes overlapping chunks of the actual spoken transcript so an
// operator's free-text question can retrieve the exact moments/quotes it
// needs, then has Groq compose an answer grounded only in those excerpts.
//
// Groq is used here (not the XAI path in sermon-summary.ts / llm.ts) per
// explicit house policy — Groq is the only sanctioned AI provider for new
// work; the existing XAI-based summary feature is left as-is.

import { asc, eq, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { transcriptSegments, sermonChunks } from "../db/schema";
import { embed, toVectorLiteral } from "../embeddings";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const TIMEOUT_MS = 8000;

// ---------- Chunking ---------------------------------------------------------
// Target ~180 words per chunk with ~25% overlap (45 words) — small enough for
// a precise retrieval hit, large enough to keep a thought/quote intact. Splits
// on sentence boundaries where possible so a chunk doesn't start/end mid-word.
const CHUNK_WORDS = 180;
const OVERLAP_WORDS = 45;

export function chunkTranscript(fullText: string): string[] {
  const words = fullText.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  if (words.length <= CHUNK_WORDS) return [words.join(" ")];

  const chunks: string[] = [];
  let start = 0;
  const step = CHUNK_WORDS - OVERLAP_WORDS;
  while (start < words.length) {
    const end = Math.min(start + CHUNK_WORDS, words.length);
    chunks.push(words.slice(start, end).join(" "));
    if (end >= words.length) break;
    start += step;
  }
  return chunks;
}

// ---------- Ingestion ---------------------------------------------------------
const MIN_TRANSCRIPT_WORDS = 40; // skip trivially short services — nothing useful to index
// A very long service could produce 100+ chunks; embedding each one is a
// network round trip, and this whole function runs inside after() with a
// finite max duration. Cap chunk count (a ~3.5-3.75hr service at typical
// speaking pace) rather than let ingestion silently run past the deadline —
// a partial/truncated ingest would look "already ingested" on retry (the
// existence check below) and never complete otherwise.
const MAX_CHUNKS = 200;
const EMBED_BATCH_SIZE = 8; // bounded concurrency, not one-at-a-time

/**
 * Chunk + embed + store a service's transcript. Idempotent per service —
 * skips if chunks already exist for this plan (called on every "AI listening
 * session ended" event, which fires once per reconnect, not once per service).
 */
export async function ingestServiceTranscript(churchId: string, servicePlanId: string): Promise<{ ingested: boolean; chunkCount: number }> {
  const db = getDb();

  const [already] = await db.select({ id: sermonChunks.id }).from(sermonChunks)
    .where(eq(sermonChunks.servicePlanId, servicePlanId)).limit(1);
  if (already) return { ingested: false, chunkCount: 0 };

  const segments = await db.select().from(transcriptSegments)
    .where(eq(transcriptSegments.servicePlanId, servicePlanId))
    .orderBy(asc(transcriptSegments.ts));
  const fullText = segments.map((s) => s.text).join(" ").trim();
  if (fullText.split(/\s+/).filter(Boolean).length < MIN_TRANSCRIPT_WORDS) {
    return { ingested: false, chunkCount: 0 };
  }

  let chunks = chunkTranscript(fullText);
  if (chunks.length === 0) return { ingested: false, chunkCount: 0 };
  if (chunks.length > MAX_CHUNKS) {
    console.warn(`[sermon-rag] service ${servicePlanId} produced ${chunks.length} chunks, truncating to ${MAX_CHUNKS}`);
    chunks = chunks.slice(0, MAX_CHUNKS);
  }

  // Bounded-concurrency batches, not fully sequential — keeps this well
  // inside after()'s execution window on a long service while still capping
  // how many embedding calls run at once.
  for (let batchStart = 0; batchStart < chunks.length; batchStart += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(batchStart, batchStart + EMBED_BATCH_SIZE);
    const vectors = await Promise.all(batch.map((c) => embed(c)));
    await Promise.all(vectors.map((vec, j) => {
      const i = batchStart + j;
      // onConflictDoNothing: closes the TOCTOU race where two
      // near-simultaneous session-end events for the same plan both pass
      // the existence check above before either finishes inserting.
      return db.execute(sql`
        INSERT INTO sermon_chunks (church_id, service_plan_id, chunk_index, text, embedding)
        VALUES (${churchId}, ${servicePlanId}, ${i}, ${chunks[i]}, ${toVectorLiteral(vec)}::vector)
        ON CONFLICT (service_plan_id, chunk_index) DO NOTHING
      `);
    }));
  }
  return { ingested: true, chunkCount: chunks.length };
}

// ---------- Retrieval ---------------------------------------------------------
export type RetrievedChunk = {
  id: string;
  text: string;
  chunkIndex: number;
  servicePlanId: string;
  planTitle: string;
  scheduledFor: string | null;
  similarity: number; // 0-100
};

export async function retrieveSermonChunks(churchId: string, query: string, limit = 8): Promise<RetrievedChunk[]> {
  const db = getDb();
  const vec = await embed(query);
  const lit = toVectorLiteral(vec);
  const rows = (await db.execute(sql`
    SELECT sc.id, sc.text, sc.chunk_index AS "chunkIndex", sc.service_plan_id AS "servicePlanId",
           sp.title AS "planTitle", sp.scheduled_for AS "scheduledFor",
           (sc.embedding <=> ${lit}::vector) AS distance
    FROM sermon_chunks sc
    JOIN service_plans sp ON sp.id = sc.service_plan_id
    WHERE sc.church_id = ${churchId} AND sc.embedding IS NOT NULL
    ORDER BY sc.embedding <=> ${lit}::vector
    LIMIT ${limit}
  `)).rows as { id: string; text: string; chunkIndex: number; servicePlanId: string; planTitle: string; scheduledFor: string | null; distance: number }[];

  return rows.map((r) => ({
    id: r.id, text: r.text, chunkIndex: r.chunkIndex, servicePlanId: r.servicePlanId,
    planTitle: r.planTitle, scheduledFor: r.scheduledFor,
    similarity: Math.max(0, Math.round((1 - r.distance) * 100)),
  }));
}

// ---------- Groq-composed answer ---------------------------------------------
export class MissingGroqKeyError extends Error {
  code = "MISSING_API_KEY" as const;
  constructor() { super("GROQ_API_KEY is not configured"); this.name = "MissingGroqKeyError"; }
}

export type SermonAnswer = { answer: string; sources: RetrievedChunk[] };

/**
 * Retrieve relevant transcript chunks and have Groq compose a grounded
 * answer, citing which service/date each point comes from. Returns the raw
 * retrieved chunks alongside the answer so the operator can jump to source
 * material, not just trust the summary.
 */
export async function answerFromSermonHistory(churchId: string, question: string): Promise<SermonAnswer> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new MissingGroqKeyError();

  const chunks = await retrieveSermonChunks(churchId, question, 8);
  if (chunks.length === 0) {
    return { answer: "No past service transcripts have been indexed yet — nothing to search.", sources: [] };
  }

  const context = chunks.map((c, i) =>
    `[${i + 1}] ${c.planTitle}${c.scheduledFor ? ` (${c.scheduledFor})` : ""}:\n${c.text}`
  ).join("\n\n");

  const messages = [
    {
      role: "system" as const,
      content: `You are answering questions about a church's own past services, using ONLY the transcript excerpts provided below. Never invent content that isn't in the excerpts. If the excerpts don't address the question, say so plainly. Cite excerpts by their [N] number when you use them.`,
    },
    { role: "user" as const, content: `Excerpts from past services:\n\n${context}` },
    { role: "user" as const, content: `Question: ${question}` },
  ];

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: GROQ_MODEL, messages, temperature: 0.2, max_tokens: 800 }),
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Groq ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json() as { choices?: { message?: { content?: string } }[] };
  const answer = data.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new Error("Groq returned an empty response");

  return { answer, sources: chunks };
}
