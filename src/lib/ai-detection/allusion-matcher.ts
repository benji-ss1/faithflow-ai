// Precision-first Bible ALLUSION matcher (v1).
//
// Detects a verse being quoted WITHOUT its reference ("he that is in you is
// greater than he that is in the world") from FINAL transcript segments, using
// a static content-word 3-gram index built offline from public-domain KJV+WEB
// (scripts/build-allusion-index.mjs). Design follows passim (maxDF), Tesserae
// (rarity + proximity) and Mullen's America's Public Bible (strict multi-gram
// evidence, abstain when ambiguous).
//
// Policy: showing NOTHING beats a related-but-wrong verse. Every gate below is
// an abstain. Results are SUGGESTIONS ONLY — callers must never auto-project
// them (CLAUDE.md rule 7); they carry isPhraseMatch semantics downstream.
//
// Pure + deterministic: no network, no DB, no LLM. O(window words · log postings).

import { allusionContentWords, allusionGramHash } from "./allusion-normalize";

export type AllusionIndexJson = {
  version: string;
  translations: string[];
  verses: number;
  postings: number;
  hashes: string; keys: string; pos: string; df: string; wr: string; counts: string; canon: string;
  refs: string;
  names?: string;
  common?: string;
};

export type AllusionIndex = {
  version: string;
  verses: number;
  hashes: Uint32Array; keys: Uint16Array; pos: Uint8Array; df: Uint8Array; wr: Uint8Array;
  counts: Uint8Array; canon: Uint16Array;
  refs: { book: string; chapter: number; verse: number }[];
  /** Stemmed proper-name/place words: topic, never quotation evidence. */
  names: Set<string>;
  /** Stemmed high-frequency Bible words; don't count as distinctive short-tier evidence. */
  common: Set<string>;
};

function decodeB64(s: string): Uint8Array {
  const fromB64 = (Uint8Array as unknown as { fromBase64?: (x: string) => Uint8Array }).fromBase64;
  if (typeof fromB64 === "function") return fromB64(s);
  if (typeof Buffer !== "undefined") {
    const b = Buffer.from(s, "base64");
    return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  }
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function aligned<T>(u8: Uint8Array, Ctor: { new (b: ArrayBuffer): T; BYTES_PER_ELEMENT: number }): T {
  const copy = new Uint8Array(u8.byteLength);
  copy.set(u8);
  return new Ctor(copy.buffer);
}

export function decodeAllusionIndex(j: AllusionIndexJson): AllusionIndex {
  return {
    version: j.version,
    verses: j.verses,
    hashes: aligned(decodeB64(j.hashes), Uint32Array),
    keys: aligned(decodeB64(j.keys), Uint16Array),
    pos: decodeB64(j.pos),
    df: decodeB64(j.df),
    wr: decodeB64(j.wr),
    counts: decodeB64(j.counts),
    canon: aligned(decodeB64(j.canon), Uint16Array),
    names: new Set((j.names ?? "").split(" ").filter(Boolean)),
    common: new Set((j.common ?? "").split(" ").filter(Boolean)),
    refs: j.refs.split(";").map((r) => {
      const [book, c, v] = r.split("|");
      return { book, chapter: Number(c), verse: Number(v) };
    }),
  };
}

/** Same result as decodeAllusionIndex, but yields between arrays so no single
 *  task decodes more than one packed array (keeps each slice well under ~50ms). */
export async function decodeAllusionIndexChunked(j: AllusionIndexJson, yieldFn: () => Promise<void>): Promise<AllusionIndex> {
  const hashes = aligned(decodeB64(j.hashes), Uint32Array); await yieldFn();
  const keys = aligned(decodeB64(j.keys), Uint16Array); await yieldFn();
  const pos = decodeB64(j.pos); const df = decodeB64(j.df); await yieldFn();
  const wr = decodeB64(j.wr); const counts = decodeB64(j.counts); const canon = aligned(decodeB64(j.canon), Uint16Array); await yieldFn();
  const names = new Set((j.names ?? "").split(" ").filter(Boolean));
  const common = new Set((j.common ?? "").split(" ").filter(Boolean));
  const refs = j.refs.split(";").map((r) => { const [book, c, v] = r.split("|"); return { book, chapter: Number(c), verse: Number(v) }; });
  return { version: j.version, verses: j.verses, hashes, keys, pos, df, wr, counts, canon, names, common, refs };
}

let indexPromise: Promise<AllusionIndex> | null = null;
/** Lazy-load the ~5MB generated index (separate chunk; never on the reference path). */
export function loadAllusionIndex(): Promise<AllusionIndex> {
  if (!indexPromise) {
    indexPromise = import("@/data/allusion-index.generated.json").then((m) =>
      decodeAllusionIndex(((m as { default?: AllusionIndexJson }).default ?? m) as AllusionIndexJson),
    );
    indexPromise.catch(() => { indexPromise = null; });
  }
  return indexPromise;
}

// ── Tuned thresholds (see eval in the PR report; tuned on 3 real JPD services) ──
export const ALLUSION_CONFIG = {
  WINDOW_WORDS: 25,          // raw words of recent FINAL transcript
  WINDOW_MAX_AGE_MS: 20_000, // segments older than this leave the window
  MIN_GRAMS: 2,              // distinct non-overlapping 3-grams …
  FIVE_GRAM_MIN_WORDS: 7,    // … or one 5-gram run plus this many matched words
  MIN_WORDS: 6,              // matched content words
  MIN_COVERAGE: 0.4,         // of the verse's content words …
  LONG_VERSE_WORDS: 8,       // … or this many matched words for long verses
  MAX_SPAN_RATIO: 1.5,       // in-order matches must be compact on both sides
  MIN_IDF: 20,               // summed idf of matched grams
  TOP_RATIO: 1.5,            // top1 score ≥ ratio × best different verse
  // Short-quote tier: one RARE 3-gram line ("train up a child in the way he should go")
  SHORT_ENABLED: true,
  SHORT_MIN_WORDS: 4,
  SHORT_MIN_COVERAGE: 0.4,   // 95% operating point (eval: 40/42 precise, 12/61 gold recall)
  SHORT_MIN_WR: 120,
  SHORT_MIN_DISTINCT: 4,     // short tier: >=4 distinct non-name words, OR …
  SHORT_RARE_WR: 150,        // … one gram in the top rarity band ("listen pay attention" can't pass)
  MIN_NONNAME_WORDS: 3,      // every tier: matched evidence must include >=3 non-name content words
  PRECEDENCE_MS: 5 * 60_000, // an active passage outranks out-of-passage candidates for this long
  PRAYER_BLOCKS_SHORT: true, // prayer markers ("we pray", "in Jesus name", "we worship you") in the last …
  PRAYER_RECENT_MS: 30_000,  // … 30s → short tier blocked (strict evidence still allowed)         // max gram word-rarity (8 x sum word idf); kills "give God praise"
  DEDUPE_MS: 60_000,
  // Continuous reading of an announced/live passage (same book+chapter, near verse)
  CTX_MAX_AGE_MS: 10 * 60_000,
  CTX_VERSE_BEFORE: 2,
  CTX_VERSE_AFTER: 12,
  CTX_MIN_WORDS: 4,
  CTX_MIN_COVERAGE: 0.3,
};
export type AllusionConfig = typeof ALLUSION_CONFIG;

export type AllusionRef = { book: string; chapter: number; verse: number };
export type AllusionMatch = AllusionRef & {
  ref: string;             // "Daniel 4:35"
  score: number;           // summed idf (internal ranking)
  confidence: number;      // display only, ALWAYS ≤ 74 (never auto-fire tier)
  matchedWords: number;
  coverage: number;
  tier: "strict" | "short" | "context"; // evidence tier that admitted it
  rarity: number;          // max gram word-rarity (diagnostic)
  matchedText: string;     // window text that produced it
};

export type AllusionContext = {
  nowMs: number;
  /** Operator service mode; "worship" abstains entirely. */
  mode?: "auto" | "worship" | "preacher";
  /** A song is currently live on the projector → abstain. */
  songLive?: boolean;
  /** The window fuzzily matches the loaded song library → abstain (caller computes). */
  lyricMatch?: boolean;
  /** The explicit parser found a reference in this segment/window → parser owns it. */
  explicitRefInWindow?: boolean;
  /** Scripture currently live, if any → never re-suggest it. */
  liveRef?: AllusionRef | null;
  /** Last explicitly announced/live passage + when it was set (continuous reading). */
  passage?: (AllusionRef & { atMs: number }) | null;
};

export type AllusionState = {
  segs: { text: string; atMs: number }[];
  emitted: Map<string, number>;
  lastPrayerAt: number;
};
export function createAllusionState(): AllusionState {
  return { segs: [], emitted: new Map(), lastPrayerAt: -Infinity };
}

const refKey = (r: AllusionRef) => `${r.book} ${r.chapter}:${r.verse}`;

function lowerBound(a: Uint32Array, x: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >>> 1; if (a[m] < x) lo = m + 1; else hi = m; }
  return lo;
}

type Hit = { j: number; p: number; df: number; wr: number };

const PRAYER_RE = /\b(we pray|let us pray|in jesus'?s? (?:mighty |precious |holy )?name|in the (?:mighty )?name of jesus|father,? (?:lord,? )?we (?:thank|worship|praise|bless) you|we (?:worship|exalt|adore|bless) you|we give you (?:all )?(?:the )?(?:praise|glory)|amen)\b/i;

/**
 * Feed one FINAL transcript segment; returns at most one allusion suggestion.
 * Always records the segment into the rolling window (even when abstaining),
 * so a quote split across segments can still complete on the next one.
 */
export function matchAllusion(
  index: AllusionIndex,
  state: AllusionState,
  segmentText: string,
  ctx: AllusionContext,
  cfg: AllusionConfig = ALLUSION_CONFIG,
): AllusionMatch | null {
  const now = ctx.nowMs;
  state.segs.push({ text: segmentText, atMs: now });
  while (state.segs.length && now - state.segs[0].atMs > cfg.WINDOW_MAX_AGE_MS) state.segs.shift();
  if (state.segs.length > 12) state.segs.splice(0, state.segs.length - 12);
  for (const [k, t] of state.emitted) if (now - t > cfg.DEDUPE_MS) state.emitted.delete(k);

  if (PRAYER_RE.test(segmentText)) state.lastPrayerAt = now;
  // Hard abstains (cheap, before any lookup).
  if (ctx.mode === "worship" || ctx.songLive || ctx.lyricMatch || ctx.explicitRefInWindow) return null;

  const newWords = allusionContentWords(segmentText).length;
  if (newWords === 0) return null;
  const rawWindow = state.segs.map((s) => s.text).join(" ").split(/\s+/).filter(Boolean);
  const windowText = rawWindow.slice(-cfg.WINDOW_WORDS).join(" ");
  const w = allusionContentWords(windowText);
  if (w.length < 3) return null;
  // grams must touch the newest segment (don't re-fire on stale words)
  const newestStart = Math.max(0, w.length - newWords);
  const isName = w.map((x) => index.names.has(x));
  const prayerWindow = cfg.PRAYER_BLOCKS_SHORT && now - state.lastPrayerAt <= cfg.PRAYER_RECENT_MS;

  const byKey = new Map<number, Hit[]>();
  for (let j = 0; j + 2 < w.length; j++) {
    if (isName[j] && isName[j + 1] && isName[j + 2]) continue; // names-only gram = topic, not quote
    const h = allusionGramHash(w[j], w[j + 1], w[j + 2]);
    let i = lowerBound(index.hashes, h);
    for (; i < index.hashes.length && index.hashes[i] === h; i++) {
      const key = index.keys[i];
      let arr = byKey.get(key);
      if (!arr) byKey.set(key, (arr = []));
      arr.push({ j, p: index.pos[i], df: index.df[i], wr: index.wr[i] });
    }
  }
  if (byKey.size === 0) return null;

  const N = index.verses;
  type Cand = { vIdx: number; t: number; score: number; words: number; coverage: number; maxWr: number; ctxOk: boolean; strictOk: boolean; shortOk: boolean; inPassage: boolean };
  const best = new Map<number, Cand>(); // canonical verseIdx → best translation

  const passage = ctx.passage && now - ctx.passage.atMs <= cfg.CTX_MAX_AGE_MS ? ctx.passage : null;
  const precedence = ctx.passage && now - ctx.passage.atMs <= cfg.PRECEDENCE_MS ? ctx.passage : null;

  let inPassageShared = false; // an in-passage verse shares grams (even if its chain is older)
  for (const [key, hits] of byKey) {
    if (precedence && !inPassageShared) {
      const r0 = index.refs[key >> 1];
      if (r0.book === precedence.book && r0.chapter === precedence.chapter) inPassageShared = true;
    }
    // Longest chain increasing in both window position j and verse position p.
    hits.sort((a, b) => a.j - b.j || a.p - b.p);
    const n = hits.length;
    const len = new Array<number>(n).fill(1);
    const prev = new Array<number>(n).fill(-1);
    let bi = 0;
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < x; y++) {
        if (hits[y].j < hits[x].j && hits[y].p < hits[x].p && len[y] + 1 > len[x]) { len[x] = len[y] + 1; prev[x] = y; }
      }
      if (len[x] > len[bi]) bi = x;
    }
    const chain: Hit[] = [];
    for (let x = bi; x >= 0; x = prev[x]) chain.unshift(hits[x]);
    if (chain[chain.length - 1].j + 2 < newestStart) continue;

    const covered = new Set<number>();
    let score = 0, grams = 0, lastEnd = -1, run = 1, maxRun = 1, maxWr = 0;
    for (let c = 0; c < chain.length; c++) {
      const g = chain[c];
      covered.add(g.j); covered.add(g.j + 1); covered.add(g.j + 2);
      score += Math.log(N / g.df);
      if (g.wr > maxWr) maxWr = g.wr;
      if (g.j > lastEnd) { grams++; lastEnd = g.j + 2; }
      if (c > 0 && g.j === chain[c - 1].j + 1 && g.p === chain[c - 1].p + 1) { run++; maxRun = Math.max(maxRun, run); } else run = 1;
    }
    const words = covered.size;
    const nonName = new Set<string>();
    for (const j of covered) if (!isName[j]) nonName.add(w[j]);
    let distinctive = 0;
    for (const x of nonName) if (!index.common.has(x)) distinctive++;
    const nonNameOk = nonName.size >= cfg.MIN_NONNAME_WORDS;
    const vCount = index.counts[key] || 1;
    const coverage = Math.min(1, words / vCount);
    const wSpan = chain[chain.length - 1].j + 3 - chain[0].j;
    const pSpan = chain[chain.length - 1].p + 3 - chain[0].p;
    const compact = wSpan <= cfg.MAX_SPAN_RATIO * pSpan && pSpan <= cfg.MAX_SPAN_RATIO * wSpan;

    const fiveGram = maxRun >= 3;
    const strictOk =
      nonNameOk && compact &&
      (grams >= cfg.MIN_GRAMS || (fiveGram && words >= cfg.FIVE_GRAM_MIN_WORDS)) &&
      words >= cfg.MIN_WORDS &&
      (coverage >= cfg.MIN_COVERAGE || words >= cfg.LONG_VERSE_WORDS) &&
      score >= cfg.MIN_IDF;
    const shortOk =
      cfg.SHORT_ENABLED && nonNameOk && compact && !prayerWindow &&
      words >= cfg.SHORT_MIN_WORDS && coverage >= cfg.SHORT_MIN_COVERAGE && maxWr >= cfg.SHORT_MIN_WR &&
      (distinctive >= cfg.SHORT_MIN_DISTINCT || (maxWr >= cfg.SHORT_RARE_WR && distinctive >= 3));

    const vIdx = key >> 1;
    const ref = index.refs[vIdx];
    const ctxOk =
      !!passage && nonNameOk && compact &&
      ref.book === passage.book && ref.chapter === passage.chapter &&
      ref.verse >= passage.verse - cfg.CTX_VERSE_BEFORE && ref.verse <= passage.verse + cfg.CTX_VERSE_AFTER &&
      words >= cfg.CTX_MIN_WORDS && coverage >= cfg.CTX_MIN_COVERAGE;

    const cIdx = index.canon[vIdx];
    const inPassage = !!precedence && ref.book === precedence.book && ref.chapter === precedence.chapter;
    const prevBest = best.get(cIdx);
    const t = key & 1;
    if (!prevBest || score > prevBest.score || (score === prevBest.score && t < prevBest.t)) {
      best.set(cIdx, { vIdx: cIdx, t, score, words, coverage, maxWr, ctxOk: ctxOk || !!prevBest?.ctxOk, strictOk: strictOk || !!prevBest?.strictOk, shortOk: shortOk || !!prevBest?.shortOk, inPassage: inPassage || !!prevBest?.inPassage });
    } else {
      prevBest.ctxOk ||= ctxOk; prevBest.strictOk ||= strictOk; prevBest.shortOk ||= shortOk; prevBest.inPassage ||= inPassage;
    }
  }

  const ranked = [...best.values()].sort((a, b) => b.score - a.score);
  let top = ranked[0];
  if (!top) return null;
  let viaPrecedence = false;
  if (precedence && !top.inPassage) {
    // Passage context precedence: an in-passage verse sharing the grams (e.g. Rom 8:36
    // quoting Ps 44:22 while Romans 8 is being read) wins unless clearly out-evidenced;
    // an out-of-passage verse otherwise needs full strict evidence.
    // Any in-passage verse that shares the matched grams wins (or we abstain if it
    // lacks evidence); an out-of-passage verse is only allowed with strict evidence
    // AND no in-passage verse sharing grams.
    const inP = ranked.find((c) => c.inPassage);
    if (inP) { top = inP; viaPrecedence = true; }
    else if (inPassageShared || !top.strictOk) return null;
  }
  if (!(top.strictOk || top.shortOk || top.ctxOk)) return null;
  if (!viaPrecedence) {
    const second = ranked.find((c) => c !== top);
    if (second && top.score < cfg.TOP_RATIO * second.score) return null;
  }

  const r = index.refs[top.vIdx];
  const key = refKey(r);
  if (ctx.liveRef && refKey(ctx.liveRef) === key) return null;
  if (state.emitted.has(key)) return null;
  state.emitted.set(key, now);
  return {
    ...r,
    ref: key,
    score: Math.round(top.score * 10) / 10,
    confidence: Math.min(74, Math.round(50 + 24 * top.coverage)),
    matchedWords: top.words,
    coverage: Math.round(top.coverage * 100) / 100,
    tier: top.strictOk ? "strict" : top.shortOk ? "short" : "context",
    rarity: top.maxWr,
    matchedText: windowText,
  };
}
