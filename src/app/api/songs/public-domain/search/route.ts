// Public-domain lyric fallback search.
//
// When the church-library matcher returns no candidates for a spoken lyric
// fragment or title, the operator client can call this endpoint to find
// candidates in publicly-known public-domain hymns.
//
// Backends (first non-empty wins):
//   1. Hymnary.org search API (public-domain hymnal metadata)
//   2. Groq LLM fallback via the same server-only pattern used elsewhere
//
// Every response is sanitised (HTML-escaped, control-char-stripped, per-slide
// text capped at 400 chars) and cached in a 200-entry LRU with 1h TTL.

import { NextResponse } from "next/server";
import { apiUser } from "@/lib/session";
import { createLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";

const searchLimiter = createLimiter("pd-search", 60, 60 * 1000);

// -----------------------------------------------------------------------
// Types + sanitizer
// -----------------------------------------------------------------------

// Types + sanitizers live in ./sanitizers so test files can import them
// without violating Next 15's route-file export restrictions.
import { sanitiseText, sanitiseCandidate, type PublicDomainCandidate } from "./sanitizers";
export type { PublicDomainCandidate };

// -----------------------------------------------------------------------
// LRU cache (200 entries, 1h TTL)
// -----------------------------------------------------------------------
type Entry = { value: PublicDomainCandidate[]; ts: number };
const CACHE_CAP = 200;
const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, Entry>();
function cacheGet(k: string): PublicDomainCandidate[] | null {
  const e = cache.get(k);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL_MS) { cache.delete(k); return null; }
  cache.delete(k); cache.set(k, e);
  return e.value;
}
function cacheSet(k: string, v: PublicDomainCandidate[]): void {
  if (cache.size >= CACHE_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(k, { value: v, ts: Date.now() });
}

// -----------------------------------------------------------------------
// Hymnary.org backend
// -----------------------------------------------------------------------
async function searchHymnary(q: string): Promise<PublicDomainCandidate[]> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    // Hymnary's public "in" endpoint returns JSON hymn text records.
    const url = `https://hymnary.org/search?in=hymns&qu=${encodeURIComponent(q)}&export=json&limit=3`;
    const res = await fetch(url, { signal: ctl.signal, headers: { "Accept": "application/json" } });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = await res.json().catch(() => null) as unknown;
    if (!Array.isArray(data)) return [];
    const out: PublicDomainCandidate[] = [];
    for (const raw of data.slice(0, 3)) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const title = typeof r.title === "string" ? r.title : (typeof r.hymnal_title === "string" ? r.hymnal_title : "");
      const author = typeof r.author === "string" ? r.author : null;
      // Hymnary's export includes a "text" or "first_line" — split to slides by verse.
      const body = typeof r.text === "string" ? r.text : (typeof r.first_line === "string" ? r.first_line : "");
      const lyricSlides = body
        .split(/\n\s*\n+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const cand = sanitiseCandidate({ source: "hymnary", title, author, lyrics: lyricSlides });
      if (cand) out.push(cand);
    }
    return out;
  } catch {
    return [];
  }
}

// -----------------------------------------------------------------------
// Groq fallback (server-only, mirrors ai-helpers pattern)
// -----------------------------------------------------------------------
async function searchGroq(q: string): Promise<PublicDomainCandidate[]> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return []; // graceful degradation
  const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 6000);
  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      signal: ctl.signal,
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 900,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: 'Return JSON {"candidates":[{"title":"...","author":"...","lyrics":["verse 1 text","verse 2 text","chorus text"]}]}. Only include VERIFIED public-domain hymns (pre-1929 or well-known traditional). Return up to 3 candidates. Never invent lyrics — if uncertain, return {"candidates":[]}.' },
          { role: "user", content: `Public-domain hymn matching lyric fragment: ${q.slice(0, 200)}` },
        ],
      }),
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = await res.json().catch(() => null) as { choices?: { message?: { content?: string } }[] } | null;
    const raw = data?.choices?.[0]?.message?.content;
    if (!raw) return [];
    let parsed: { candidates?: unknown };
    try { parsed = JSON.parse(raw); } catch { return []; }
    const cands = Array.isArray(parsed.candidates) ? parsed.candidates : [];
    const out: PublicDomainCandidate[] = [];
    for (const raw of cands.slice(0, 3)) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const cand = sanitiseCandidate({
        source: "llm",
        title: typeof r.title === "string" ? r.title : "",
        author: typeof r.author === "string" ? r.author : null,
        lyrics: Array.isArray(r.lyrics) ? r.lyrics as string[] : [],
      });
      if (cand) out.push(cand);
    }
    return out;
  } catch {
    clearTimeout(timer);
    return [];
  }
}

// -----------------------------------------------------------------------
// Route handler
// -----------------------------------------------------------------------
export async function GET(req: Request) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ok = await searchLimiter(user.id);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 3) {
    return NextResponse.json({ error: "q must be at least 3 characters" }, { status: 400 });
  }
  if (q.length > 300) return NextResponse.json({ error: "q too long" }, { status: 400 });

  const key = q.toLowerCase();
  const hit = cacheGet(key);
  if (hit) return NextResponse.json({ candidates: hit, cached: true });

  // Try Hymnary first, fall back to Groq.
  let candidates = await searchHymnary(q);
  if (candidates.length === 0) candidates = await searchGroq(q);

  cacheSet(key, candidates);
  return NextResponse.json({ candidates, cached: false });
}

// _internal for tests lives in ./sanitizers now.
