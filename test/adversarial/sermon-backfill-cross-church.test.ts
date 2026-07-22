/**
 * Adversarial test — the sermon-backfill write path cannot be used to write
 * into or read another church's data, and the cron cannot be hit as an open
 * endpoint.
 *
 * Source-assertion style (matches audio-sessions-cross-church.test.ts): the
 * routes are auth/session shaped and can't be exercised standalone without a
 * full request context, so we assert the church-scoping + auth invariants
 * hold in source. Rule 5 (CLAUDE.md) requires an adversarial test for every
 * new church-scoped write path.
 *
 * Run: npx tsx test/adversarial/sermon-backfill-cross-church.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

let passed = 0;
let failed = 0;
function t(label: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${label}`); }
  catch (e) { failed++; console.error(`  FAIL  ${label}: ${e instanceof Error ? e.message : e}`); }
}

const backfill = fs.readFileSync(path.resolve(__dirname, "../../src/app/api/sermon/backfill/route.ts"), "utf8");
const cron = fs.readFileSync(path.resolve(__dirname, "../../src/app/api/cron/backfill-sermons/route.ts"), "utf8");
const rag = fs.readFileSync(path.resolve(__dirname, "../../src/lib/server/sermon-rag.ts"), "utf8");
const ask = fs.readFileSync(path.resolve(__dirname, "../../src/app/api/sermon/ask/route.ts"), "utf8");

console.log("sermon-backfill cross-church guards");

t("backfill POST is role-gated (admin/pastor)", () => {
  assert.match(backfill, /apiRequireRole\(\s*["']admin["']\s*,\s*["']pastor["']\s*\)/);
  assert.match(backfill, /status:\s*403/);
});

t("backfill writes churchId from session, never from body", () => {
  assert.match(backfill, /churchId:\s*user\.churchId/);
  assert.ok(!/churchId:\s*body\./.test(backfill), "must NOT trust body.churchId");
});

t("backfill transcript_segment is tied to the freshly-created plan.id", () => {
  assert.match(backfill, /servicePlanId:\s*plan\.id/);
});

t("backfill enforces size/word/title caps", () => {
  assert.match(backfill, /500_000|500000/);      // body cap
  assert.match(backfill, /length < 40|>= 40|40\+/); // word floor (loose match)
});

t("ask endpoint scopes retrieval by session churchId", () => {
  assert.match(ask, /user\.churchId/);
  assert.ok(!/churchId:\s*body\.|body\.churchId/.test(ask), "ask must not take churchId from body");
});

t("RAG retrieval SQL filters by church_id", () => {
  assert.match(rag, /WHERE\s+sc\.church_id\s*=\s*\$\{?churchId/i);
});

t("RAG chunk insert stamps church_id", () => {
  assert.match(rag, /INSERT INTO sermon_chunks[\s\S]*church_id/i);
});

t("cron fails CLOSED when CRON_SECRET is unset", () => {
  // Must return 401 when secret is absent — not fall through to running.
  assert.match(cron, /if\s*\(\s*!secret\s*\)/);
  const idx = cron.indexOf("!secret");
  const window = cron.slice(idx, idx + 120);
  assert.match(window, /status:\s*401/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
