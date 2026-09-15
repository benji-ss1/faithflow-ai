#!/usr/bin/env node
// Offline builder for the precision-first Bible allusion index.
//
//   npm run allusion:index -- --bible <dir with KJV.json, WEB.json> [--speech <dir of transcript json>]
//
// Input Bible files: [{ b: "Genesis", c: 1, v: 1, t: "..." }] (public domain KJV + WEB).
// Transcripts (optional, for the count-based stoplist only) are NEVER written to
// the repo — only short 3-gram strings + counts are, and they are human-reviewable.
//
// Output: src/data/allusion-index.generated.json — compact packed arrays (base64):
//   hashes   Uint32 sorted gram hashes (one row per (gram, verseKey) posting)
//   keys     Uint16 verseKey = verseIdx*2 + translation (0=KJV, 1=WEB)
//   pos      Uint8  content-word position of the gram inside the verse
//   df       Uint8  distinct canonical verses containing the gram (1..MAX_DF)
//   wr       Uint8  word rarity: round(8 × Σ word idf) of the gram's 3 words
//   counts   Uint8  content-word count per verseKey
//   canon    Uint16 canonical verseIdx per verseIdx (exact-duplicate parallels merged)
//   refs     "Book|chapter|verse" per verseIdx (KJV versification order)
//
// Run with tsx so it shares the exact normaliser used at runtime.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  allusionContentWords,
  allusionGramHash,
  ALLUSION_NORMALIZER_VERSION,
} from "../src/lib/ai-detection/allusion-normalize.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith("--") ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
);
const BIBLE = args.bible;
if (!BIBLE) {
  console.error("usage: --bible <dir> [--speech <dir>]");
  process.exit(1);
}
const MAX_DF = 3;
const STOPLIST_MIN_SEGMENTS = 4; // gram heard in ≥4 transcript segments …
const STOPLIST_MIN_SERVICES = 2; // … across ≥2 different services → generic speech
const OUT_INDEX = path.join(ROOT, "src/data/allusion-index.generated.json");
const OUT_STOP = path.join(ROOT, "src/data/allusion-stoplist.generated.json");
const DENY = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/allusion-denylist.json"), "utf8"));

const kjv = JSON.parse(fs.readFileSync(path.join(BIBLE, "KJV.json"), "utf8"));
const translations = [kjv];
if (fs.existsSync(path.join(BIBLE, "WEB.json"))) translations.push(JSON.parse(fs.readFileSync(path.join(BIBLE, "WEB.json"), "utf8")));

const refs = kjv.map((r) => `${r.b}|${r.c}|${r.v}`);
const idxOf = new Map(refs.map((r, i) => [r, i]));
const N = refs.length;
if (N * 2 > 65535) throw new Error("verseKey overflow");

// content words per verseKey
const words = new Array(N * 2);
translations.forEach((tr, t) => {
  for (const r of tr) {
    const i = idxOf.get(`${r.b}|${r.c}|${r.v}`);
    if (i === undefined) continue; // versification differences (WEB-only refs)
    words[i * 2 + t] = allusionContentWords(r.t);
  }
});

// exact-duplicate parallel verses → canonical (first) verseIdx, by KJV content text
const canon = new Uint16Array(N);
{
  const seen = new Map();
  for (let i = 0; i < N; i++) {
    const k = (words[i * 2] || []).join(" ");
    if (k && seen.has(k)) canon[i] = seen.get(k);
    else { canon[i] = i; if (k) seen.set(k, i); }
  }
}

// word document frequency over canonical verses (any translation) → per-gram rarity
const wordDf = new Map();
for (let i = 0; i < N; i++) {
  const seen = new Set([...(words[i * 2] || []), ...(words[i * 2 + 1] || [])]);
  for (const w of seen) wordDf.set(w, (wordDf.get(w) || 0) + 1);
}
const wordIdf = (w) => Math.log(N / (wordDf.get(w) || 1));

function denyHashes() {
  const s = new Set();
  for (const p of DENY.phrases) {
    const w = allusionContentWords(p);
    for (let j = 0; j + 2 < w.length; j++) s.add(allusionGramHash(w[j], w[j + 1], w[j + 2]));
  }
  return s;
}

function buildPostings(exclude) {
  const byHash = new Map(); // hash -> { canon:Set, posts:[key,pos] , gram }
  for (let key = 0; key < N * 2; key++) {
    const w = words[key];
    if (!w) continue;
    for (let j = 0; j + 2 < w.length && j < 255; j++) {
      const h = allusionGramHash(w[j], w[j + 1], w[j + 2]);
      if (exclude.has(h)) continue;
      let e = byHash.get(h);
      if (!e) byHash.set(h, (e = { canon: new Set(), posts: [], gram: `${w[j]} ${w[j + 1]} ${w[j + 2]}`, wr: Math.min(255, Math.round((wordIdf(w[j]) + wordIdf(w[j + 1]) + wordIdf(w[j + 2])) * 8)) }));
      e.canon.add(canon[key >> 1]);
      e.posts.push(key, j);
    }
  }
  for (const [h, e] of byHash) if (e.canon.size > MAX_DF) byHash.delete(h);
  return byHash;
}

const deny = denyHashes();
let postings = buildPostings(deny);

// Count-based stoplist: grams that survive maxDF but are heard repeatedly in
// ordinary church speech across services are generic, not allusions.
if (args.speech) {
  const counts = new Map(); // hash -> { gram, segs, services:Set }
  for (const f of fs.readdirSync(args.speech).filter((x) => x.endsWith(".json"))) {
    const { segments } = JSON.parse(fs.readFileSync(path.join(args.speech, f), "utf8"));
    for (const seg of segments) {
      const w = allusionContentWords(seg.text);
      const inSeg = new Set();
      for (let j = 0; j + 2 < w.length; j++) {
        const h = allusionGramHash(w[j], w[j + 1], w[j + 2]);
        if (postings.has(h)) inSeg.add(h);
      }
      for (const h of inSeg) {
        let c = counts.get(h);
        if (!c) counts.set(h, (c = { gram: postings.get(h).gram, segments: 0, services: new Set() }));
        c.segments++;
        c.services.add(f);
      }
    }
  }
  const grams = [...counts.values()]
    .filter((c) => c.segments >= STOPLIST_MIN_SEGMENTS && c.services.size >= STOPLIST_MIN_SERVICES)
    .map((c) => ({ gram: c.gram, segments: c.segments, services: c.services.size }))
    .sort((a, b) => b.segments - a.segments || a.gram.localeCompare(b.gram));
  const stop = {
    version: `s-${new Date().toISOString().slice(0, 10)}-${ALLUSION_NORMALIZER_VERSION}`,
    generatedAt: new Date().toISOString(),
    rule: `content 3-gram present in the index AND heard in >=${STOPLIST_MIN_SEGMENTS} transcript segments across >=${STOPLIST_MIN_SERVICES} services`,
    sourceServices: fs.readdirSync(args.speech).filter((x) => x.endsWith(".json")).length,
    grams,
  };
  fs.writeFileSync(OUT_STOP, JSON.stringify(stop, null, 2) + "\n");
  console.error(`stoplist: ${grams.length} grams → ${path.relative(ROOT, OUT_STOP)}`);
}

// Apply the committed stoplist (whether just generated or reviewed earlier).
let stopVersion = "none";
if (fs.existsSync(OUT_STOP)) {
  const stop = JSON.parse(fs.readFileSync(OUT_STOP, "utf8"));
  stopVersion = stop.version;
  const ex = new Set(deny);
  for (const g of stop.grams) {
    const [a, b, c] = g.gram.split(" ");
    ex.add(allusionGramHash(a, b, c));
  }
  postings = buildPostings(ex);
}

// Pack
const rows = [];
for (const [h, e] of postings) for (let i = 0; i < e.posts.length; i += 2) rows.push([h, e.posts[i], e.posts[i + 1], e.canon.size, e.wr]);
rows.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const hashes = new Uint32Array(rows.length);
const keys = new Uint16Array(rows.length);
const pos = new Uint8Array(rows.length);
const df = new Uint8Array(rows.length);
const wr = new Uint8Array(rows.length);
rows.forEach((r, i) => { hashes[i] = r[0]; keys[i] = r[1]; pos[i] = r[2]; df[i] = r[3]; wr[i] = r[4]; });
const counts = new Uint8Array(N * 2);
for (let k = 0; k < N * 2; k++) counts[k] = Math.min(255, words[k]?.length ?? 0);

const b64 = (ta) => Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength).toString("base64");
const out = {
  version: `ai1-${ALLUSION_NORMALIZER_VERSION}-df${MAX_DF}-${DENY.version}-${stopVersion}`,
  translations: translations.length === 2 ? ["KJV", "WEB"] : ["KJV"],
  verses: N,
  postings: rows.length,
  hashes: b64(hashes),
  keys: b64(keys),
  pos: b64(pos),
  df: b64(df),
  wr: b64(wr),
  counts: b64(counts),
  canon: b64(canon),
  refs: refs.join(";"),
};
fs.writeFileSync(OUT_INDEX, JSON.stringify(out));
console.error(`index ${out.version}: ${rows.length} postings, ${(fs.statSync(OUT_INDEX).size / 1e6).toFixed(2)} MB → ${path.relative(ROOT, OUT_INDEX)}`);
