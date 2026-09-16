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

/**
 * A palette hit. `lexical` / `semantic` come straight from `HybridHit` — the
 * relevance GATE below reads `lexical` (see `gateByLexical`).
 */
export type BiblePaletteHit = BibleSearchHit & { lexical?: boolean; semantic?: boolean };

/**
 * Why a render is empty. The palette must distinguish "the engine answered and
 * had nothing" from "the engine refused us" (429 / 5xx / network) — the latter
 * gets a one-line message and is NEVER cached, so a retype can succeed.
 */
export type BiblePaletteStatus = "ok" | "busy";

/** Server enforces the same floor; keep them in sync. */
export const BIBLE_PALETTE_MIN_CHARS = 3;
/** Trailing debounce. Long enough that a typed word is one request. */
export const BIBLE_PALETTE_DEBOUNCE_MS = 250;
export const BIBLE_PALETTE_LIMIT = 5;
/**
 * The palette sends no `translation`, so the server searches the public-domain
 * default (KJV). Cache under that code so the key means what it says.
 *
 * NOTE (review fix, 2026-09-16): this is a PALETTE-LOCAL cache in practice, not
 * a shared one. The key is `KJV:<BIBLE_PALETTE_LIMIT>:<query>` while BibleMode
 * keys on the operator's own translation code and its own Results limit
 * (10/20/50/100), so the two surfaces essentially never collide. Cross-surface
 * reuse is a theoretical bonus if both ever land on KJV at the same limit — do
 * not rely on it.
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

/**
 * RELEVANCE GATE (review fix 🔴2, 2026-09-16).
 *
 * RRF gives the top hit `1/(60+1)` = 0.016393 for EVERY query — including
 * gibberish ("asdfgh qwerty zxcv" → Mark 4:3) — so a numeric score floor can
 * never be a relevance gate. The only honest signal is whether the LEXICAL arm
 * (FTS over the KJV+WEB corpus) actually matched: real words from a real verse
 * match lexically, noise does not.
 *
 * CAVEAT that shapes the contract: `hybridSearch` SKIPS the lexical arm
 * entirely when the FTS index isn't valid (`ftsIndexReady`, bible.ts) — in that
 * state NO hit is ever `lexical`, and a naive gate would silently hide the
 * Bible group everywhere. So the server reports `lexicalAvailable` and the gate
 * is applied ONLY when it is true; otherwise we fall back to the ungated
 * behaviour (semantic-only results, exactly as before this fix).
 *
 * When gating: require at least one lexical hit (else render nothing), and
 * order lexical hits first so the anchored match is what Enter would take.
 */
export function gateByLexical(hits: BiblePaletteHit[], lexicalAvailable: boolean): BiblePaletteHit[] {
  if (!lexicalAvailable) return hits;
  if (!hits.some((h) => h.lexical === true)) return [];
  return [...hits.filter((h) => h.lexical === true), ...hits.filter((h) => h.lexical !== true)];
}

/**
 * Keys of references ALREADY VISIBLE on the fast path, for `dedupeAgainstShown`.
 *
 * Review fix 🟡2 (2026-09-16): this used to seed ALL 8 COMMON_REFS
 * unconditionally, but those items are subject to cmdk's filter — for "i can do
 * all things" the item value "bible Philippians 4:13" scores 0, so Phil 4:13 was
 * HIDDEN from the Bible group *and* suppressed from the server group: the one
 * verse the operator asked for appeared nowhere. A common ref now only
 * suppresses a server hit when its own item actually renders (score > 0, or an
 * empty query where cmdk shows everything). `scoreFn` is cmdk's own
 * `defaultFilter`, passed in so this stays pure/unit-testable.
 */
export function fastPathShownKeys(
  query: string,
  commonRefs: readonly string[],
  phraseKeys: readonly string[],
  scoreFn: (value: string, search: string) => number,
): Set<string> {
  const keys = new Set<string>(phraseKeys);
  const q = query.trim();
  for (const ref of commonRefs) {
    if (q && scoreFn(`bible ${ref}`, q) <= 0) continue; // item is filtered out → invisible → must not suppress
    let p: { book: string; chapter: number; verseStart: number } | undefined;
    try { p = parseTypedReference(ref)[0]; } catch { p = undefined; }
    if (p) keys.add(refKey({ book: p.book, chapter: p.chapter, verse: p.verseStart }));
  }
  return keys;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<{ ok?: boolean; json: () => Promise<unknown> }>;

export type BiblePaletteSearcherOptions = {
  onResults: (query: string, hits: BiblePaletteHit[], status?: BiblePaletteStatus) => void;
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
      if (gen === generation) opts.onResults(q, cached.hits, "ok");
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
      const json = (await res.json().catch(() => ({}))) as {
        hits?: BiblePaletteHit[];
        results?: BiblePaletteHit[];
        error?: string;
        lexicalAvailable?: boolean;
      };
      if (c.signal.aborted || gen !== generation) return;
      // Review fix 🔴4 (2026-09-16): a 429 / 5xx used to look EXACTLY like "no
      // verses found" — empty group, no message — and because the empty result
      // wasn't cached, retyping kept hammering the same exhausted bucket. Now
      // it renders one explanatory line and is never cached as a result.
      if (res.ok === false || json?.error) { opts.onResults(q, [], "busy"); return; }
      const raw = (json?.hits || json?.results || []).slice(0, limit);
      const hits = gateByLexical(raw, json?.lexicalAvailable === true);
      // Cache the GATED list: it is what we render, so a repeat is identical.
      setBibleSearchCached(key, hits, PALETTE_TRANSLATION);
      opts.onResults(q, hits, "ok");
    } catch {
      // A SUPERSEDED request (AbortError) must stay silent; a genuine network
      // failure otherwise left the PREVIOUS query's verses on screen, so it
      // reports "busy" like a 429 (one line, review 🟢 note 2026-09-16).
      if (!c.signal.aborted && gen === generation) opts.onResults(q, [], "busy");
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
      opts.onResults(q, [], "ok");
      return;
    }
    const gen = ++generation;
    timer = setTimeout(() => { timer = null; void run(q, gen); }, debounceMs);
  };

  return { search, cancel };
}
