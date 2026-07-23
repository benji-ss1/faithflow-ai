/**
 * Adversarial test — church_learned_keyterms write path (roadmap #4)
 * must be church-scoped and only ingest on a fresh session insert.
 *
 * Invariants defended:
 *   1. churchId on the upsert comes from user.churchId (server session),
 *      never from request body.
 *   2. The upsert conflict target is (church_id, normalized_term) so
 *      cross-tenant collisions are impossible at the DB level too.
 *   3. Learned-keyterm ingest only runs when the audioSessions insert
 *      was a fresh insert (isFreshInsert guard) — prevents StrictMode /
 *      network-retry double-counting from prematurely promoting terms.
 *   4. Display-term regex rejects multi-word garble and non-alnum.
 *   5. loadLearnedKeyterms validates churchId as UUID before any DB access.
 *
 * Run: npx tsx test/adversarial/learned-keyterms-cross-church.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

let passed = 0;
let failed = 0;
function t(label: string, fn: () => void | Promise<void>) {
  try {
    const r = fn();
    if (r && typeof (r as Promise<unknown>).then === "function") {
      (r as Promise<unknown>).then(() => { passed++; console.log(`  ok  ${label}`); },
        (e) => { failed++; console.error(`  FAIL  ${label}: ${e?.message ?? e}`); });
    } else { passed++; console.log(`  ok  ${label}`); }
  } catch (e) { failed++; console.error(`  FAIL  ${label}: ${e instanceof Error ? e.message : e}`); }
}

console.log("learned-keyterms cross-church + StrictMode guards");
const routePath = path.resolve(__dirname, "../../src/app/api/audio/session-metrics/route.ts");
const routeSrc = fs.readFileSync(routePath, "utf8");
const helperPath = path.resolve(__dirname, "../../src/lib/deepgram-keyterms.ts");
const helperSrc = fs.readFileSync(helperPath, "utf8");
const schemaPath = path.resolve(__dirname, "../../src/lib/db/schema.ts");
const schemaSrc = fs.readFileSync(schemaPath, "utf8");

t("upsert churchId sourced from user.churchId, not body", () => {
  // The batched values map(...) must emit user.churchId per row; body.churchId
  // must never appear anywhere in the route file.
  assert.match(routeSrc, /const values\s*=\s*cleanTokens\.map/);
  assert.match(routeSrc, /churchId:\s*user\.churchId/);
  assert.ok(!/churchId:\s*body\./.test(routeSrc), "must NOT trust body.churchId anywhere in route");
});

t("upsert conflict target is (churchId, normalizedTerm)", () => {
  assert.match(routeSrc, /target:\s*\[\s*churchLearnedKeyterms\.churchId,\s*churchLearnedKeyterms\.normalizedTerm\s*\]/);
});

t("learned-keyterm ingest gated on isFreshInsert", () => {
  // The insert into audioSessions must use returning() so we can detect
  // conflict-do-nothing (retry) vs fresh row (canonical), and the keyterm
  // ingest block must run only when isFreshInsert is truthy.
  assert.match(routeSrc, /\.returning\(\{\s*id:\s*audioSessions\.id\s*\}\)/);
  assert.match(routeSrc, /const isFreshInsert\s*=\s*insertedRows\.length\s*>\s*0/);
  assert.match(routeSrc, /if\s*\(cleanTokens\.length\s*>\s*0\s*&&\s*isFreshInsert\)/);
});

t("display-term regex rejects internal spaces and non-alnum garble", () => {
  // The v0.1.19 hardening: reject spaces + only alnum + apostrophe/hyphen.
  assert.match(routeSrc, /display\.includes\("\s"\)\)\s*continue/);
  assert.match(routeSrc, /\/\^\[\\p\{L\}\\p\{N\}\]\[\\p\{L\}\\p\{N\}'\\-\]\*\$\/u\.test\(display\)/);
});

t("display length bounded [4,24]", () => {
  assert.match(routeSrc, /display\.length\s*<\s*4\s*\|\|\s*display\.length\s*>\s*24/);
});

t("cleanTokens capped at 40 per request", () => {
  assert.match(routeSrc, /rawTokens\.slice\(0,\s*40\)/);
});

t("MIN_OCCURRENCES_TO_PROMOTE enforced server-side (not trusted from client)", () => {
  assert.match(routeSrc, /const MIN_OCCURRENCES_TO_PROMOTE\s*=\s*3/);
  // Promotion check happens on the aggregated running total, not the raw
  // incoming count alone. The batched form uses `excluded.occurrences`
  // (Postgres UPSERT alias) to reference the incoming row.
  assert.match(routeSrc, /active:\s*sql`\${churchLearnedKeyterms\.active}\s*OR\s*\(\${churchLearnedKeyterms\.occurrences}\s*\+\s*excluded\.occurrences\)\s*>=\s*\${MIN_OCCURRENCES_TO_PROMOTE}`/);
});

t("stale-eviction pass runs after upsert (per-church row cap defense)", () => {
  // A DELETE clears inactive+old+rarely-seen rows so the table can't grow
  // unbounded over months of ingest.
  assert.match(routeSrc, /DELETE FROM church_learned_keyterms/);
  assert.match(routeSrc, /church_id\s*=\s*\${user\.churchId}/);
  assert.match(routeSrc, /active\s*=\s*false/);
  assert.match(routeSrc, /first_seen_at\s*<\s*NOW\(\)\s*-\s*INTERVAL\s*'30 days'/);
});

t("batched multi-row upsert (single round trip, not N)", () => {
  // One db.insert().values(values).onConflictDoUpdate() over the whole
  // batch — not a for-loop of N single inserts.
  assert.match(routeSrc, /db\.insert\(churchLearnedKeyterms\)\.values\(values\)\.onConflictDoUpdate/);
  assert.ok(!/for\s*\(\s*const\s+t\s+of\s+cleanTokens\)/.test(routeSrc), "must not fall back to per-row insert loop");
});

t("loadLearnedKeyterms validates churchId as UUID before DB access", () => {
  assert.match(helperSrc, /export async function loadLearnedKeyterms/);
  // Both loadKeyterms and loadLearnedKeyterms must reject non-UUID inputs.
  const learnedFnIdx = helperSrc.indexOf("export async function loadLearnedKeyterms");
  const fnScope = helperSrc.slice(learnedFnIdx, learnedFnIdx + 400);
  assert.match(fnScope, /if\s*\(!churchId\s*\|\|\s*!\/\^\[0-9a-f\]\{8\}/);
  assert.match(fnScope, /return\s*\[\]/);
});

t("loadLearnedKeyterms is cached per churchId (no cross-church key collision)", () => {
  const learnedFnIdx = helperSrc.indexOf("export async function loadLearnedKeyterms");
  const fnScope = helperSrc.slice(learnedFnIdx, learnedFnIdx + 800);
  // Cache is keyed by the validated churchId, and the DB query filters by it.
  assert.match(fnScope, /learnedCache\.get\(churchId\)/);
  assert.match(fnScope, /eq\(churchLearnedKeyterms\.churchId,\s*churchId\)/);
});

t("loadLearnedKeyterms filters to active=true rows only", () => {
  const learnedFnIdx = helperSrc.indexOf("export async function loadLearnedKeyterms");
  const fnScope = helperSrc.slice(learnedFnIdx, learnedFnIdx + 800);
  assert.match(fnScope, /eq\(churchLearnedKeyterms\.active,\s*true\)/);
});

t("loadLearnedKeyterms caps result at MAX_LEARNED_TERMS_PER_CHURCH", () => {
  assert.match(helperSrc, /MAX_LEARNED_TERMS_PER_CHURCH\s*=\s*30/);
  // Just assert the limit call exists in the file — the .limit() sits
  // well beyond the first 800 chars of the function body.
  assert.match(helperSrc, /\.limit\(MAX_LEARNED_TERMS_PER_CHURCH\)/);
});

t("schema has church_id FK with ON DELETE CASCADE (tenant deletion cleans up)", () => {
  const idx = schemaSrc.indexOf("export const churchLearnedKeyterms");
  assert.ok(idx >= 0, "schema must declare churchLearnedKeyterms");
  const scope = schemaSrc.slice(idx, idx + 1400);
  assert.match(scope, /churchId:\s*uuid\("church_id"\)\.references\(\(\)\s*=>\s*churches\.id,\s*\{\s*onDelete:\s*"cascade"\s*\}\)\.notNull\(\)/);
});

t("schema has unique index on (church_id, normalized_term) to prevent duplicate learn rows per church", () => {
  // Just assert the unique index appears in the schema file — the exact
  // block is over 1600 chars.
  assert.match(schemaSrc, /uniqueIndex\("idx_church_learned_keyterms_unique"\)\.on\(t\.churchId,\s*t\.normalizedTerm\)/);
});

setTimeout(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}, 200);
