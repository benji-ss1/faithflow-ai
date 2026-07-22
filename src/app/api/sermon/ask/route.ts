/**
 * Chunk-level RAG Q&A over a church's own past service transcripts.
 * POST { question } -> { answer, sources }
 *
 * churchId is authoritative from the session — never from the request body.
 * Uses Groq exclusively (see src/lib/server/sermon-rag.ts for why this is
 * kept separate from the existing XAI-based sermon-summary feature).
 */
import { NextResponse } from "next/server";
import { apiUser } from "@/lib/session";
import { answerFromSermonHistory, MissingGroqKeyError } from "@/lib/server/sermon-rag";
import { createLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";

const check = createLimiter("api-sermon-ask", 20, 60_000);

export async function POST(req: Request) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ok = await check(user.id);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": "60" } });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question || question.length > 500) {
    return NextResponse.json({ error: "question must be 1-500 characters" }, { status: 400 });
  }

  try {
    const result = await answerFromSermonHistory(user.churchId, question);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof MissingGroqKeyError) {
      return NextResponse.json({ error: "AI search isn't configured yet — GROQ_API_KEY missing." }, { status: 503 });
    }
    console.error("[sermon/ask] failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
