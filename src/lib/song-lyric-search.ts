/**
 * Lyric search for the operator song library (Songs search bar + Cmd+K).
 *
 * PURE module — no React, no fetch, no DOM. Operators type a remembered line
 * (chorus / verse / bridge / slide 10) and get the whole song back plus the
 * matching line and its slide order, so a click can jump straight to it.
 *
 * Deliberately independent of the live AI detector (src/lib/ai-detection/*):
 * this only reads the same library shape; it never feeds detection.
 *
 * Index: one MiniSearch document per slide {songId, title, artist, slideOrder,
 * line}, title boosted ~3x. Tokens are normalised (NFKD, combining marks
 * stripped, lowercase, apostrophes dropped, other punctuation → space) so
 * "ẹ ṣé baba" == "e se baba" and "Don't" == "dont". Prefix search is on;
 * fuzzy (0.2) applies only to terms ≥4 chars so short words don't explode.
 * Results are grouped per song (best slide wins) with a phrase-contiguity
 * bonus, and title/substring matches rank first for title-like queries.
 */
import MiniSearch from "minisearch";

export type LyricLibrarySong = {
  songId: string;
  title: string;
  artist?: string | null;
  slides: { order: number; lyrics: string }[];
};

export type SongLyricHit = {
  songId: string;
  title: string;
  artist: string | null;
  matchedLine: string;
  slideOrder: number;
  score: number;
  /** True when the hit came from the title rather than a lyric line. */
  titleMatch: boolean;
};

type SlideDoc = {
  id: string;
  songId: string;
  title: string;
  artist: string;
  slideOrder: number;
  line: string;
};

export type SongLyricIndex = {
  mini: MiniSearch<SlideDoc>;
  /** songId → normalised title (for title-tier ranking). */
  titles: Map<string, string>;
  /** doc id → normalised line tokens (for contiguity scoring). */
  lineTokens: Map<string, string[]>;
  /** songId → its first slide doc (fallback for title-only hits). */
  firstDoc: Map<string, SlideDoc>;
  /** Every normalised token in titles + lyrics (decides prefix/fuzzy per word). */
  vocab: Set<string>;
  size: number;
};

// Very common function words. They're left out of the BM25 query (their
// posting lists span most of the library and dominate query cost) but still
// count in the phrase-contiguity re-rank, which uses the full query.
const STOPWORDS = new Set(
  "a an the and or of to in on at is are was be am i you he she it we they my your his her our their me him us them this that with for as by from so oh".split(" "),
);

export function normaliseText(s: string): string {
  return (s || "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/['’‘`´]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function tokenise(s: string): string[] {
  const n = normaliseText(s);
  return n ? n.split(" ") : [];
}

const FUZZY = 0.2;
const MIN_FUZZY_LEN = 4;
const RERANK_CAP = 120;

function maxEdits(term: string): number {
  if (term.length < MIN_FUZZY_LEN) return 0;
  return Math.round(term.length * FUZZY);
}

/** Bounded Levenshtein (returns max+1 once exceeded). */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

function termMatches(q: string, t: string, allowPrefix: boolean): boolean {
  if (q === t) return true;
  if (allowPrefix && q.length >= 2 && t.startsWith(q)) return true;
  const m = maxEdits(q);
  return m > 0 && editDistance(q, t, m) <= m;
}

/**
 * termMatches for query word `qi` against line token `t`, memoised per query.
 * The cache MUST only ever be used with one queryTokens array (keys are by index).
 */
function cachedTermMatch(queryTokens: string[], qi: number, t: string, cache?: Map<string, boolean>): boolean {
  const q = queryTokens[qi];
  if (q === t) return true;
  const isLast = qi === queryTokens.length - 1;
  if (!cache) return termMatches(q, t, isLast);
  const k = `${qi} ${t}`;
  let v = cache.get(k);
  if (v === undefined) { v = termMatches(q, t, isLast); cache.set(k, v); }
  return v;
}

/** Longest run of consecutive query tokens appearing contiguously in the line. */
export function longestContiguousRun(
  queryTokens: string[],
  lineTokens: string[],
  /** Optional per-query memo: common words repeat across slides, so edit-distance checks do too. */
  cache?: Map<string, boolean>,
): number {
  let best = 0;
  const eq = (qi: number, t: string) => cachedTermMatch(queryTokens, qi, t, cache);
  for (let qi = 0; qi < queryTokens.length; qi++) {
    for (let li = 0; li < lineTokens.length; li++) {
      let run = 0;
      while (
        qi + run < queryTokens.length &&
        li + run < lineTokens.length &&
        eq(qi + run, lineTokens[li + run])
      ) run++;
      if (run > best) best = run;
      if (best === queryTokens.length) return best;
    }
  }
  return best;
}

/** Extract the line of a slide that best matches the query (for display). */
function bestLine(lyrics: string, queryTokens: string[], cache?: Map<string, boolean>): string {
  const lines = lyrics.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 1) return lyrics.replace(/\s+/g, " ").trim();
  let best = lines[0];
  let bestScore = -1;
  for (const l of lines) {
    const toks = tokenise(l);
    const run = longestContiguousRun(queryTokens, toks, cache);
    const hits = queryTokens.filter((_, i) => toks.some((t) => cachedTermMatch(queryTokens, i, t, cache))).length;
    const s = run * 10 + hits;
    if (s > bestScore) { bestScore = s; best = l; }
  }
  return best;
}

export type SongLyricIndexBuilder = {
  /** Index up to ~`batchSlides` more slides. Returns true when the index is complete. */
  step(): boolean;
  /** The finished index (null until step() has returned true). */
  readonly index: SongLyricIndex | null;
};

/**
 * Incremental builder so the UI can index a ~20k-slide library in small
 * chunks during idle time (no single long task freezes audio/projection).
 */
export function createSongLyricIndexBuilder(library: LyricLibrarySong[], batchSlides = 2000): SongLyricIndexBuilder {
  const mini = new MiniSearch<SlideDoc>({
    idField: "id",
    fields: ["title", "line"],
    storeFields: ["songId", "title", "artist", "slideOrder", "line"],
    tokenize: (text) => tokenise(text),
    processTerm: (term) => term || null,
  });
  const titles = new Map<string, string>();
  const lineTokens = new Map<string, string[]>();
  const firstDoc = new Map<string, SlideDoc>();
  const vocab = new Set<string>();
  const songs = (library ?? []).filter((s) => s?.songId);
  let songIdx = 0;
  let size = 0;
  let done: SongLyricIndex | null = null;
  const addDoc = (d: SlideDoc, toks: string[], batch: SlideDoc[]) => {
    batch.push(d);
    lineTokens.set(d.id, toks);
    if (!firstDoc.has(d.songId)) firstDoc.set(d.songId, d);
    for (const t of toks) vocab.add(t);
  };
  return {
    get index() { return done; },
    step() {
      if (done) return true;
      const batch: SlideDoc[] = [];
      while (songIdx < songs.length && batch.length < batchSlides) {
        const song = songs[songIdx++];
        const tn = normaliseText(song.title);
        titles.set(song.songId, tn);
        if (tn) for (const t of tn.split(" ")) vocab.add(t);
        const slides = (song.slides ?? []).filter((s) => s && typeof s.lyrics === "string" && s.lyrics.trim());
        if (slides.length === 0) {
          // Title-only doc so a lyric-less song is still findable by title.
          addDoc({ id: `${song.songId}#t`, songId: song.songId, title: song.title, artist: song.artist ?? "", slideOrder: -1, line: "" }, [], batch);
          continue;
        }
        for (const sl of slides) {
          const id = `${song.songId}#${sl.order}`;
          if (lineTokens.has(id)) continue; // duplicate order guard
          addDoc({ id, songId: song.songId, title: song.title, artist: song.artist ?? "", slideOrder: sl.order, line: sl.lyrics }, tokenise(sl.lyrics), batch);
        }
      }
      mini.addAll(batch);
      size += batch.length;
      if (songIdx >= songs.length) done = { mini, titles, lineTokens, firstDoc, vocab, size };
      return !!done;
    },
  };
}

/** Synchronous build (tests / scripts). The UI uses the chunked builder instead. */
export function buildSongLyricIndex(library: LyricLibrarySong[]): SongLyricIndex {
  const b = createSongLyricIndexBuilder(library, Number.MAX_SAFE_INTEGER);
  while (!b.step()) { /* single step */ }
  return b.index!;
}

export function searchSongLyrics(index: SongLyricIndex | null, query: string, limit = 20): SongLyricHit[] {
  if (!index || index.size === 0) return [];
  const qTokens = tokenise(query);
  if (qTokens.length === 0) return [];
  const qNorm = qTokens.join(" ");
  const last = qTokens.length - 1;

  // Single pass. Stopwords are dropped from the BM25 query when real content
  // words remain; prefix expands only a half-typed last word (one that isn't
  // already a complete library word); fuzzy (0.2, ≥4 chars) expands only words
  // that don't exist in the library at all — the likely typos. Expanding every
  // word over a ~20k-slide vocabulary was the slow path.
  const content = qTokens.filter((q) => !STOPWORDS.has(q));
  // Deduped: a repeated word ("Thou ... Thou") must not inflate the coverage denominator.
  let searchTerms = [...new Set(content.length > 0 ? content : qTokens)];
  const lastTerm = qTokens[last];
  const searchText = searchTerms.join(" ");
  // Short (≤3-word) queries are usually titles → title-first ranking + 3x title
  // boost. Longer queries are usually a remembered line → a contiguous lyric
  // phrase must beat a title that only shares some words.
  const shortQuery = qTokens.length <= 3;
  const baseOpts = {
    boost: { title: shortQuery ? 3 : 1 },
    combineWith: "OR" as const,
    prefix: (term: string) => term === lastTerm && term.length >= 2 && !index.vocab.has(term),
  };
  const vocabFuzzy = (term: string) => (term.length >= MIN_FUZZY_LEN && !index.vocab.has(term) ? FUZZY : false);
  // AND first: a remembered line normally contains every content word, and AND
  // is ~3x cheaper than OR over large posting lists (measured on ~20k slides).
  // Fall back to OR (partial matches) only when AND finds nothing.
  let raw = searchTerms.length >= 2
    ? index.mini.search(searchText, { ...baseOpts, combineWith: "AND", fuzzy: vocabFuzzy, maxFuzzy: 3 })
    : [];
  if (raw.length === 0) {
    raw = index.mini.search(searchText, { ...baseOpts, fuzzy: vocabFuzzy, maxFuzzy: 3 });
  }
  // A typo can land on a DIFFERENT real word ("shall" → "sall" if "sall" exists),
  // which the vocab check won't fuzz. If every word was a known word yet no
  // top slide contains them all, retry once with fuzzy on all ≥4-char words.
  const anyFuzzed = searchTerms.some((q) => q.length >= MIN_FUZZY_LEN && !index.vocab.has(q));
  if (!anyFuzzed && searchTerms.length >= 2 && searchTerms.some((q) => q.length >= MIN_FUZZY_LEN)) {
    const covered = raw.slice(0, RERANK_CAP).some((r) => (r.queryTerms?.length ?? 0) >= searchTerms.length);
    if (!covered) {
      raw = index.mini.search(searchText, {
        ...baseOpts,
        fuzzy: (term: string) => (term.length >= MIN_FUZZY_LEN ? FUZZY : false),
        maxFuzzy: 3,
      });
    }
  }
  // Nothing found from the content words alone (e.g. the only one is a short
  // typo like "sou", below the fuzzy minimum): retry with the full query,
  // stopwords included, so "with my sou it is" still finds "It Is Well".
  if (raw.length === 0 && content.length > 0 && content.length < qTokens.length) {
    searchTerms = [...new Set(qTokens)];
    raw = index.mini.search(searchTerms.join(" "), {
      ...baseOpts,
      fuzzy: (term: string) => (term.length >= MIN_FUZZY_LEN && !index.vocab.has(term) ? FUZZY : false),
      maxFuzzy: 3,
    });
  }
  const matchCache = new Map<string, boolean>();
  // Title tier: exact title (3) > title contains the query (2) > everything else.
  // Scanned directly over all titles (cheap: one string per song) so a
  // title/substring match ranks first even if BM25 put it past the re-rank cap.
  const titleTier = new Map<string, number>();
  if (qNorm.length >= 2) {
    for (const [songId, tn] of index.titles) {
      if (!tn) continue;
      if (tn === qNorm) titleTier.set(songId, 3);
      else if (tn.includes(qNorm)) titleTier.set(songId, 2);
    }
  }
  if (raw.length === 0 && titleTier.size === 0) return [];

  type Agg = { songId: string; title: string; artist: string | null; slideOrder: number; line: string; score: number; titleMatch: boolean; tier: number };
  const bySong = new Map<string, Agg>();
  // Re-rank only the strongest raw slide hits: MiniSearch already sorts by
  // BM25, and contiguity scoring over every weak OR-match (e.g. "lord") would
  // cost O(results × words) per keystroke.
  for (const r of raw.slice(0, RERANK_CAP)) {
    const songId = r.songId as string;
    // Coverage from MiniSearch's own matched query terms (fuzzy/prefix aware).
    const coverage = (r.queryTerms?.length ?? 0) / searchTerms.length;
    // Multi-word queries must hit at least half the words; kills scattered junk.
    if (coverage === 0 || (searchTerms.length >= 2 && coverage < 0.5)) continue;
    const prev = bySong.get(songId);
    // Cheap upper bound: contiguity multiplier ≤ 3. Skip slides that can't win.
    if (prev && r.score * 3 * (0.5 + coverage) <= prev.score) continue;

    const titleNorm = index.titles.get(songId) ?? "";
    const lineToks = index.lineTokens.get(r.id as string) ?? [];
    const titleToks = titleNorm ? titleNorm.split(" ") : [];
    const lineRun = longestContiguousRun(qTokens, lineToks, matchCache);
    const titleRun = titleToks.length ? longestContiguousRun(qTokens, titleToks, matchCache) : 0;
    const tier = titleTier.get(songId) ?? 0;
    // Long queries: only the lyric phrase counts for contiguity unless the title
    // holds (nearly) the whole query.
    const titleRunUse = shortQuery || titleRun >= qTokens.length - 1 ? titleRun : 0;
    const contiguity = Math.max(lineRun, titleRunUse) / qTokens.length;
    const score = r.score * (1 + 2 * contiguity) * (0.5 + coverage);
    const cand: Agg = {
      songId,
      title: r.title as string,
      artist: (r.artist as string) || null,
      slideOrder: r.slideOrder as number,
      line: (r.line as string) || "",
      score,
      titleMatch: tier > 0 || (titleRun === qTokens.length && titleRun >= lineRun),
      tier,
    };
    // Keep the best-scoring slide per song.
    if (!prev || cand.score > prev.score) bySong.set(songId, cand);
  }
  // Title matches outside the re-ranked window still surface (first slide).
  for (const [songId, tier] of titleTier) {
    if (bySong.has(songId)) continue;
    const doc = index.firstDoc.get(songId);
    if (!doc) continue;
    bySong.set(songId, { songId, title: doc.title, artist: doc.artist || null, slideOrder: doc.slideOrder, line: doc.line, score: 0, titleMatch: true, tier });
  }

  const out = [...bySong.values()];
  if (out.length === 0) return [];
  out.sort((a, b) => b.tier - a.tier || b.score - a.score);
  // Relative floor: drop the long tail far below the best lyric hit.
  const topScore = out.reduce((m, h) => Math.max(m, h.score), 0);
  return out
    .filter((h) => h.tier > 0 || h.score >= topScore * 0.08)
    .slice(0, Math.max(1, limit))
    .map((h) => ({
      songId: h.songId,
      title: h.title,
      artist: h.artist,
      slideOrder: h.slideOrder,
      matchedLine: h.line ? bestLine(h.line, qTokens, matchCache) : "",
      score: h.score,
      titleMatch: h.titleMatch,
    }));
}
