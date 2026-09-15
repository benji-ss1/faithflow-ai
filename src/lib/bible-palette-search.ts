/**
 * Bible verse search for the ⌘K palette (2026-09-16).
 *
 * WHY: the palette's "Bible" capability used to be 8 hardcoded references
 * plus the curated phrase corpus — it never asked the server — so typing a
 * remembered phrase ("love is patient") returned songs only. This module owns
 * the small amount of LOGIC that wiring the real hybrid engine
 * (`POST /api/bible/search` → `hybridSearch`) into the palette needs, kept
 * OUT of the component so it is directly unit-testable.
 *
 * RATE-LIMIT CONTRACT (hard requirement): `/api/bible/search` is capped at
 * 20 req/min/user and SHARES that budget with BibleMode's reference box. A
 * palette that fired per keystroke would burn it in three words. So:
 *   - min 3 characters (also enforced server-side),
 *   - parser-confirmed references never hit the network (the fast path
 *     already resolves them locally),
 *   - a trailing debounce (default 250ms) — a normally typed word issues at
 *     most ONE request, and only once typing pauses,
 *   - the session cache (`bible-search-cache.ts`) answers repeats with zero
 *     requests,
 *   - superseded in-flight requests are aborted so a slow response can never
 *     overwrite newer results.
 *
 * Nothing here runs on the live audio/detection path — the searcher is only
 * driven while the palette is open.
 */
import { parseTypedReference } from "@/lib/bible-parser";
import {
  bibleSearchCacheKey,
  getBibleSearchCached,
  setBibleSearchCached,
  type BibleSearchHit,
} from "@/lib/bible-search-cache";

export type BiblePaletteHit = BibleSearchHit;

/** Server enforces the same floor; keep them in sync. */
export const BIBLE_PALETTE_MIN_CHARS = 3;
/** Trailing debounce. Long enough that a typed word is one request. */
export const BIBLE_PALETTE_DEBOUNCE_MS = 250;
export const BIBLE_PALETTE_LIMIT = 5;
/**
 * The palette sends no `translation`, so the server searches the public-domain
 * default (KJV). Cache under that code so keys mean what they say — and so a
 * repeat of the same phrase in BibleMode can reuse it when limits match.
 */
const PALETTE_TRANSLATION = "KJV";

/**
 * Loose "looks like a reference" shape. Cheap pre-filter only — it also
 * matches ordinary lyric text with a number in it ("bless the lord 10000
 * reasons"), which is exactly why it must NOT be the gate on its own.
 */
export const BIBLE_REF_SHAPE = /\b(?:[1-3]\s*)?[a-z]{3,}\s*\d+(?::\d+(?:\s*-\s*\d+)?)?\b/i;

/**
 * The ONE predicate both the Bible/phrase group and the lyric group gate on
 * (2026-09-16 symmetry fix). Previously the Bible/phrase group was suppressed
 * by the LOOSE shape while lyrics were suppressed only by a parser-confirmed
 * reference — an asymmetry that silently hid Bible results for any query
 * containing a number. A real reference ("John 3:16") still suppresses lyrics
 * exactly as before.
 */
export function isConfirmedBibleReference(query: string): boolean {
  const q = query.trim();
  if (!q) return false;
  if (!BIBLE_REF_SHAPE.test(q)) return false;
  try {
    return parseTypedReference(q).length > 0;
  } catch {
    return false;
  }
}

/** Should this query go to the server at all? */
export function shouldRunBiblePaletteSearch(query: string): boolean {
  const q = query.trim();
  if (q.length < BIBLE_PALETTE_MIN_CHARS) return false;
  if (q.length > 200) return false; // server rejects longer
  // A confirmed reference is already served instantly by the local fast path.
  if (isConfirmedBibleReference(q)) return false;
  return true;
}

export function refKey(h: { book: string; chapter: number; verse: number }): string {
  return `${h.book.toLowerCase()}|${h.chapter}|${h.verse}`;
}

/**
 * Drop any hit whose reference is already on screen from the fast path
 * (COMMON_REFS / phrase corpus) so the operator never sees the same verse
 * twice in one palette.
 */
export function dedupeAgainstShown(hits: BiblePaletteHit[], shownKeys: Iterable<string>): BiblePaletteHit[] {
  const shown = new Set(shownKeys);
  const seen = new Set<string>();
  const out: BiblePaletteHit[] = [];
  for (const h of hits) {
    const k = refKey(h);
    if (shown.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(h);
  }
  return out;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<{ ok?: boolean; json: () => Promise<unknown> }>;

export type BiblePaletteSearcherOptions = {
  onResults: (query: string, hits: BiblePaletteHit[]) => void;
  onPending?: (pending: boolean) => void;
  fetchImpl?: FetchLike;
  debounceMs?: number;
  limit?: number;
};

export type BiblePaletteSearcher = {
  /** Feed the current input value. Debounced; safe to call per keystroke. */
  search: (query: string) => void;
  /** Cancel any pending timer + in-flight request (palette closed). */
  cancel: () => void;
};

export function createBiblePaletteSearcher(opts: BiblePaletteSearcherOptions): BiblePaletteSearcher {
  const debounceMs = opts.debounceMs ?? BIBLE_PALETTE_DEBOUNCE_MS;
  const limit = opts.limit ?? BIBLE_PALETTE_LIMIT;
  const doFetch: FetchLike = opts.fetchImpl ?? ((u, i) => fetch(u, i));

  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  let generation = 0;

  const clearTimer = () => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
  };
  const abortInFlight = () => {
    if (controller) { controller.abort(); controller = null; }
  };

  const cancel = () => {
    generation++;
    clearTimer();
    abortInFlight();
    opts.onPending?.(false);
  };

  const run = async (q: string, gen: number) => {
    // Cache first — a repeat/refine costs ZERO requests against the 20/min bucket.
    const key = bibleSearchCacheKey(PALETTE_TRANSLATION, q, limit);
    const cached = getBibleSearchCached(key);
    if (cached) {
      if (gen === generation) opts.onResults(q, cached.hits);
      return;
    }
    // Supersede: a newer query aborts the older request so a slow stale
    // response can never land after (and overwrite) a newer one.
    abortInFlight();
    const c = new AbortController();
    controller = c;
    opts.onPending?.(true);
    try {
      const res = await doFetch("/api/bible/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, limit }),
        signal: c.signal,
      });
      const json = (await res.json()) as { hits?: BiblePaletteHit[]; results?: BiblePaletteHit[]; error?: string };
      if (c.signal.aborted || gen !== generation) return;
      if (json?.error) { opts.onResults(q, []); return; } // incl. 429 — fail quiet, songs still show
      const hits = (json?.hits || json?.results || []).slice(0, limit);
      if (hits.length > 0) setBibleSearchCached(key, hits, PALETTE_TRANSLATION);
      opts.onResults(q, hits);
    } catch {
      // AbortError (superseded) or network — never surface noise in the palette.
    } finally {
      if (controller === c) { controller = null; opts.onPending?.(false); }
    }
  };

  const search = (query: string) => {
    const q = query.trim();
    clearTimer();
    if (!shouldRunBiblePaletteSearch(q)) {
      // Ineligible input clears the group and cancels anything outstanding —
      // no request is ever issued for it.
      generation++;
      abortInFlight();
      opts.onPending?.(false);
      opts.onResults(q, []);
      return;
    }
    const gen = ++generation;
    timer = setTimeout(() => { timer = null; void run(q, gen); }, debounceMs);
  };

  return { search, cancel };
}
