// Server-only. Do not import from client components.
//
// ESV.org API fallback scaffold (2026-07-30 — Change 1 to-100).
//
// When the seeded DB doesn't carry ESV verses (they're licensed but the
// ESV publisher provides a free-tier API for developers), fall back to
// esv.org's REST endpoint. Wraps with a 24h in-memory cache so a repeated
// lookup during a single service doesn't hammer the API.
//
// Env-gated: if `process.env.ESV_API_KEY` isn't set, `fetchEsvVerses`
// returns null and callers must degrade gracefully (they already do — the
// operator sees the "not available" toast from applyTranslationSwitch).
//
// This module is a SCAFFOLD — it's not yet wired into src/lib/server/bible.ts
// because that file is WIP for another change. When ready, the integration
// point is `lookupReference` — call fetchEsvVerses first when
// translationCode === "ESV" and licensed-translation check would return [].
//
// Docs: see docs/BIBLE_TRANSLATIONS.md for licensing notes on NIV / NLT /
// NASB / MSG (paid, not implemented) and how to get an ESV.org key.

export type EsvVerse = {
  book: string;
  chapter: number;
  verse: number;
  text: string;
};

type CacheEntry = { at: number; value: EsvVerse[] };
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const cache = new Map<string, CacheEntry>();

// Guard against unbounded growth in a long-running Node process.
const MAX_CACHE_ENTRIES = 500;

function cacheKey(book: string, chapter: number, verseStart: number, verseEnd: number): string {
  return `${book.toLowerCase()}|${chapter}|${verseStart}|${verseEnd}`;
}

function trimCache(): void {
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  // Drop oldest half — simple LRU-ish sweep.
  const entries = [...cache.entries()].sort((a, b) => a[1].at - b[1].at);
  for (let i = 0; i < entries.length / 2; i++) cache.delete(entries[i][0]);
}

/**
 * Fetch a verse range from the ESV.org API. Returns null when the API key
 * isn't configured (env-gated no-op) or on any network / API error.
 * Callers should treat null as "fall through to normal flow" — never as
 * a hard failure.
 *
 * @returns array of {book, chapter, verse, text} or null.
 */
export async function fetchEsvVerses(
  book: string,
  chapter: number,
  verseStart: number,
  verseEnd: number,
): Promise<EsvVerse[] | null> {
  const key = process.env.ESV_API_KEY;
  if (!key) return null; // env-gated silent no-op — this is the expected default

  const cKey = cacheKey(book, chapter, verseStart, verseEnd);
  const cached = cache.get(cKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  // ESV.org REST format: https://api.esv.org/docs/passage-text/
  //   GET https://api.esv.org/v3/passage/text/?q=John+3:16-17
  //   Authorization: Token <ESV_API_KEY>
  const range = verseEnd > verseStart ? `${verseStart}-${verseEnd}` : `${verseStart}`;
  const q = encodeURIComponent(`${book} ${chapter}:${range}`);
  const url = `https://api.esv.org/v3/passage/text/?q=${q}`
    + `&include-headings=false&include-footnotes=false&include-verse-numbers=true`
    + `&include-short-copyright=false&include-passage-references=false`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Token ${key}` },
      // Node fetch default: no timeout. Short-circuit slow responses so a
      // stalled API doesn't hang the service.
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { passages?: string[] };
    const passage = data?.passages?.[0];
    if (typeof passage !== "string" || passage.length === 0) return null;

    // Passage looks like: "  [1] In the beginning...  [2] The earth was..."
    // Split on the ESV verse-number marker "[N]" and rebuild verse objects.
    const verses: EsvVerse[] = [];
    const parts = passage.split(/\[(\d+)\]\s*/).slice(1); // drop leading whitespace preamble
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const v = parseInt(parts[i], 10);
      const text = parts[i + 1].replace(/\s+/g, " ").trim();
      if (Number.isFinite(v) && text) verses.push({ book, chapter, verse: v, text });
    }
    if (verses.length === 0) return null;

    cache.set(cKey, { at: Date.now(), value: verses });
    trimCache();
    return verses;
  } catch {
    // Timeout / network / parse — degrade silently.
    return null;
  }
}

/** For tests / admin diagnostics. */
export function clearEsvCache(): void {
  cache.clear();
}
