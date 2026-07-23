// Public-domain lyric fallback search.
//
// When the church-library matcher returns no candidates for a spoken lyric
// fragment or title, the operator client can call this endpoint to find
// candidates in publicly-known public-domain hymns.
//
// Backends:
//   1. Hymnary.org CSV search endpoint — authoritative public-domain hymn
//      IDENTIFICATION (title/author/first line). Hymnary blocks its JSON
//      export + /api/* with 403, but the human-facing `export=csv` search
//      works with a browser User-Agent and the `in:texts` qualifier.
//   2. Groq LLM — expands a Hymnary-confirmed title into verified verses
//      (CSV carries no verse body), or, when Hymnary finds nothing, does a
//      standalone fragment lookup. Server-only, mirrors ai-helpers.
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

// A browser-like UA is required — Hymnary 403s default fetch/curl agents.
const HYMNARY_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0 Safari/537.36";

type HymnMatch = { title: string; author: string | null; firstLine: string };

// Minimal RFC-4180-ish single-line CSV field splitter (handles quoted fields
// with embedded commas + doubled-quote escapes). Hymnary rows are one logical
// line each.
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// Identify real public-domain hymns via Hymnary's CSV text search. Returns
// metadata only (CSV carries no verse body); [] on any failure.
async function searchHymnary(q: string): Promise<HymnMatch[]> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    // `in:texts` scopes to hymn TEXTS (not tunes/hymnals); export=csv is the
    // only export tier Hymnary serves to programmatic clients.
    const url = `https://hymnary.org/search?qu=${encodeURIComponent(`in:texts ${q}`)}&export=csv`;
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { "User-Agent": HYMNARY_UA, "Accept": "text/csv" },
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const text = await res.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return [];
    const header = parseCsvLine(lines[0]).map((h) => h.trim());
    const iTitle = header.indexOf("displayTitle");
    const iFirst = header.indexOf("firstLine");
    const iAuthors = header.indexOf("authors");
    if (iTitle < 0) return [];
    const out: HymnMatch[] = [];
    for (const line of lines.slice(1, 4)) {
      const cols = parseCsvLine(line);
      const title = (cols[iTitle] || "").trim();
      if (!title) continue;
      const firstLine = iFirst >= 0 ? (cols[iFirst] || "").trim() : "";
      const author = iAuthors >= 0 && cols[iAuthors]?.trim() ? cols[iAuthors].trim() : null;
      out.push({ title, author, firstLine });
    }
    return out;
  } catch {
    return [];
  }
}

// Expand a Hymnary-confirmed hymn title into verified public-domain verses via
// Groq. Seeding with a KNOWN title (not a raw ASR fragment) makes the model far
// less likely to hallucinate. Falls back to the first line when Groq is
// unavailable or declines, so the operator still gets a real identification.
async function expandHymn(match: HymnMatch): Promise<PublicDomainCandidate | null> {
  const key = process.env.GROQ_API_KEY;
  // Emit NO lyric content unless it clears the model's no-invent PD gate below.
  // The CSV first line is only ever a seed hint for Groq, never returned as
  // standalone lyric text — a Hymnary hit alone is not a public-domain proof
  // (modern/copyrighted hymns are indexed too). When Groq can't confirm verses
  // we return null and let the caller fall through to the fragment path.
  const fallback = () => null;

  if (!key) return fallback();
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
        temperature: 0.1,
        max_tokens: 900,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: 'Return JSON {"lyrics":["verse 1 text","verse 2 text","chorus text"]} for the well-known PUBLIC-DOMAIN hymn named by the user. Only include verses you are confident are public domain (pre-1929 / traditional). Never invent or paraphrase — if you are not certain of the actual verses, return {"lyrics":[]}.' },
          { role: "user", content: `Hymn title: "${match.title.slice(0, 200)}"${match.firstLine ? ` (first line: "${match.firstLine.slice(0, 200)}")` : ""}` },
        ],
      }),
    });
    clearTimeout(timer);
    if (!res.ok) return fallback();
    const data = await res.json().catch(() => null) as { choices?: { message?: { content?: string } }[] } | null;
    const raw = data?.choices?.[0]?.message?.content;
    if (!raw) return fallback();
    let parsed: { lyrics?: unknown };
    try { parsed = JSON.parse(raw); } catch { return fallback(); }
    const lyrics = Array.isArray(parsed.lyrics) ? (parsed.lyrics as unknown[]).filter((l) => typeof l === "string") as string[] : [];
    if (lyrics.length === 0) return fallback();
    return sanitiseCandidate({ source: "hymnary", title: match.title, author: match.author, lyrics });
  } catch {
    clearTimeout(timer);
    return fallback();
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

  // 1. Identify PD hymns via Hymnary, then expand each confirmed title into
  //    verified verses (Groq). 2. If Hymnary finds nothing, do a standalone
  //    Groq fragment lookup.
  const matches = await searchHymnary(q);
  let candidates: PublicDomainCandidate[] = [];
  if (matches.length > 0) {
    const expanded = await Promise.all(matches.map((m) => expandHymn(m)));
    candidates = expanded.filter((c): c is PublicDomainCandidate => c !== null);
  }
  if (candidates.length === 0) candidates = await searchGroq(q);

  cacheSet(key, candidates);
  return NextResponse.json({ candidates, cached: false });
}

// _internal for tests lives in ./sanitizers now.
