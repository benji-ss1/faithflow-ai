/**
 * Bible sanity test. Run with:
 *   npx tsx --env-file=.env.local src/lib/server/bible.test.ts
 *
 * Verifies:
 *   1. Each of the 7 PD translations returns John 3:16 via lookupReference.
 *   2. For 3 selected PD translations, semantic search on "for God so loved
 *      the world" returns John 3:16 in the top 10 (or WARN if embeddings
 *      are missing).
 *   3. For NIV/ESV/NKJV (licensed), both lookup and semantic search return
 *      empty. This is the licensing invariant.
 */
import { getDb } from "../db/client";
import { bibleTranslations } from "../db/schema";
import { asc } from "drizzle-orm";
import { lookupReference, semanticSearch, embeddedVerseCount } from "./bible";

const PD_CODES = ["ASV", "DARBY", "DRC", "GEN1599", "KJV", "WEB", "YLT"];
const LICENSED_CODES = ["NIV", "ESV", "NKJV"];
const SEMANTIC_SAMPLE = ["KJV", "WEB", "ASV"];

type Result = { name: string; ok: boolean; detail?: string; warn?: boolean };
const results: Result[] = [];

function pass(name: string, detail?: string) { results.push({ name, ok: true, detail }); }
function fail(name: string, detail: string) { results.push({ name, ok: false, detail }); }
function warn(name: string, detail: string) { results.push({ name, ok: true, warn: true, detail }); }

async function main() {
  const db = getDb();
  const rows = await db.select().from(bibleTranslations).orderBy(asc(bibleTranslations.code));
  const byCode = new Map(rows.map((r) => [r.code, r]));

  // 1) PD lookup for John 3:16
  for (const code of PD_CODES) {
    const t = byCode.get(code);
    if (!t) { fail(`lookup:${code}`, "translation row missing"); continue; }
    try {
      const verses = await lookupReference(t.id, "John", 3, 16, 16);
      if (verses.length !== 1) { fail(`lookup:${code}`, `expected 1 verse, got ${verses.length}`); continue; }
      const v = verses[0];
      if (v.book !== "John" || v.chapter !== 3 || v.verse !== 16) {
        fail(`lookup:${code}`, `book/chapter/verse mismatch: ${v.book} ${v.chapter}:${v.verse}`);
        continue;
      }
      if (!v.text || v.text.length < 20) { fail(`lookup:${code}`, `text too short: "${v.text}"`); continue; }
      pass(`lookup:${code}`, `John 3:16 → "${v.text.slice(0, 60)}…"`);
    } catch (e) {
      fail(`lookup:${code}`, e instanceof Error ? e.message : String(e));
    }
  }

  // 2) Semantic search for 3 sampled PD translations
  for (const code of SEMANTIC_SAMPLE) {
    const t = byCode.get(code);
    if (!t) { fail(`semantic:${code}`, "translation row missing"); continue; }
    const emb = await embeddedVerseCount(t.id);
    if (emb.done === 0) { warn(`semantic:${code}`, `no embeddings computed (${emb.done}/${emb.total}) — skipped`); continue; }
    try {
      const hits = await semanticSearch(t.id, "for God so loved the world", 10);
      const found = hits.find((h) => h.book === "John" && h.chapter === 3 && h.verse === 16);
      if (!found) {
        fail(`semantic:${code}`, `John 3:16 not in top 10 hits (got ${hits.length} results)`);
        continue;
      }
      pass(`semantic:${code}`, `John 3:16 in top 10`);
    } catch (e) {
      fail(`semantic:${code}`, e instanceof Error ? e.message : String(e));
    }
  }

  // 3) Licensing invariant — must return empty for NIV/ESV/NKJV
  for (const code of LICENSED_CODES) {
    const t = byCode.get(code);
    if (!t) { fail(`invariant:${code}`, "licensed slot row missing in DB"); continue; }

    try {
      const verses = await lookupReference(t.id, "John", 3, 16, 16);
      if (verses.length !== 0) {
        fail(`invariant:${code}:lookup`, `LICENSING VIOLATION — lookup returned ${verses.length} rows`);
        continue;
      }
      pass(`invariant:${code}:lookup`, "empty (as required)");
    } catch (e) {
      fail(`invariant:${code}:lookup`, e instanceof Error ? e.message : String(e));
    }

    try {
      const hits = await semanticSearch(t.id, "for God so loved the world", 10);
      if (hits.length !== 0) {
        fail(`invariant:${code}:semantic`, `LICENSING VIOLATION — semantic search returned ${hits.length} rows`);
        continue;
      }
      pass(`invariant:${code}:semantic`, "empty (as required)");
    } catch (e) {
      fail(`invariant:${code}:semantic`, e instanceof Error ? e.message : String(e));
    }
  }

  // Report
  let passed = 0;
  let failed = 0;
  let warned = 0;
  for (const r of results) {
    if (!r.ok) { failed++; console.error(`FAIL  ${r.name} — ${r.detail}`); }
    else if (r.warn) { warned++; console.warn(`WARN  ${r.name} — ${r.detail}`); }
    else { passed++; console.log(`PASS  ${r.name}${r.detail ? " — " + r.detail : ""}`); }
  }
  console.log(`\n${passed}/${results.length} passed  (warn: ${warned}, fail: ${failed})`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
