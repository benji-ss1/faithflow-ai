/**
 * PR B per-church styles — capability, church scoping, whitelist and migration
 * invariants. Source assertions (no DB needed).
 * Run: npx tsx test/adversarial/church-styles-scope.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasCap } from "../../src/lib/session";

const src = readFileSync("src/lib/actions.ts", "utf8");
function body(name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const next = src.indexOf("\nexport async function ", start + 10);
  return src.slice(start, next < 0 ? undefined : next);
}
function helper(name: string): string {
  const start = src.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  return src.slice(start, src.indexOf("\n}\n", start));
}
let n = 0;
const ok = (cond: unknown, msg: string) => { assert.ok(cond, msg); n++; };

// ── capabilities: volunteer scripture ok / content-type denied / viewer denied ──
ok(hasCap("volunteer", "operate_services") && !hasCap("volunteer", "edit_library"), "volunteer: operate yes, edit_library no");
ok(!hasCap("viewer", "operate_services") && !hasCap("viewer", "edit_library"), "viewer: neither");
ok(!hasCap("pastor", "operate_services"), "pastor cannot operate");

const ss = body("setScriptureStyle");
ok(/if \(!hasCap\(user\.role, "operate_services"\)\) return \{ ok: false/.test(ss), "setScriptureStyle gated on operate_services with {ok:false}");
ok(/expectedChurchId !== undefined && opts\.expectedChurchId !== user\.churchId\) return \{ ok: false, error: CHURCH_STYLES_WRONG_CHURCH/.test(ss), "setScriptureStyle refuses a write queued for another church");
ok(!/requireCap|requireRole|redirect\(/.test(ss), "setScriptureStyle never redirects (live console safe)");
ok(/SCRIPTURE_DESIGN_MAX_BYTES/.test(ss) && /sanitizeScriptureDesign\(design\)/.test(ss), "setScriptureStyle size-caps + sanitizes");
ok(/scriptureStyleUpdatedAt: sql`now\(\)`/.test(ss), "updated_at bumped on every write (incl. clear)");
ok(/eq\(churchPreferences\.churchId, user\.churchId\)/.test(ss), "setScriptureStyle church-scoped");
ok(/ifEmpty[\s\S]*scriptureStyle\} IS NULL[\s\S]*scriptureStyleUpdatedAt\} IS NULL/.test(ss), "ifEmpty = atomic conditional update on NULL value AND NULL updated_at (single winner)");
ok(/\.returning\(/.test(ss) && /applied: updated\.length > 0/.test(ss), "loser learns applied:false + gets server value");
ok(!/\.select\(\)[\s\S]{0,80}then[\s\S]{0,200}\.update\(/.test(ss), "no read-then-write race for ifEmpty");

const cs = body("setContentTypeStyles");
ok(/if \(!hasCap\(user\.role, ifEmpty \? "operate_services" : "edit_library"\)\) return \{ ok: false/.test(cs), "normal content-type save needs edit_library; only ifEmpty migration allowed for operate_services");
ok(/expectedChurchId !== undefined && opts\.expectedChurchId !== user\.churchId\) return \{ ok: false, error: CHURCH_STYLES_WRONG_CHURCH/.test(cs), "setContentTypeStyles refuses a write queued for another church");
ok(/contentTypeStylesUpdatedAt: sql`now\(\)`/.test(cs), "content-type updated_at bumped on every write");
ok(!/requireCap|requireRole|redirect\(/.test(cs), "setContentTypeStyles never redirects");
ok(/sanitizeContentTypeStyles\(next\)/.test(cs), "keys/uuids validated");
ok(/eq\(themes\.churchId, user\.churchId\), inArray\(themes\.id, ids\)/.test(cs), "theme ids verified against THIS church");
ok(/!ownedIds\.has\(clean\[k\]!\)\) delete clean\[k\]/.test(cs), "foreign theme ids dropped");
ok(/contentTypeStylesUpdatedAt\} IS NULL`, sql`\$\{churchPreferences\.contentTypeStyles\} = '\{\}'::jsonb/.test(cs), "ifEmpty conditional on never-set (updated_at NULL) AND empty object");
ok(/eq\(churchPreferences\.churchId, user\.churchId\)/.test(cs), "setContentTypeStyles church-scoped");

const gs = body("getChurchStyles");
ok(/hasCap\(user\.role, "operate_services"\)/.test(gs) && /readChurchStyles\(user\.churchId\)/.test(gs), "getChurchStyles gated + church-scoped");
ok(/return \{\n    churchId,/.test(helper("readChurchStyles")), "responses carry the session churchId");
ok(/eq\(churchPreferences\.churchId, churchId\)/.test(helper("readChurchStyles")), "read helper filters by church");
ok(/onConflictDoNothing\(\{ target: churchPreferences\.churchId \}\)/.test(helper("ensurePreferencesRow")), "row creation is conflict-safe");

// ── updatePreferences whitelist ignores the new columns ──
const up = body("updatePreferences");
for (const k of ["scriptureStyle", "contentTypeStyles", "scriptureStyleUpdatedAt", "contentTypeStylesUpdatedAt"]) {
  ok(!up.includes(k), `updatePreferences never writes ${k}`);
}
ok(!/\.set\(\{ \.\.\.data/.test(up) && !/values\(\{[^}]*\.\.\.data/.test(up), "updatePreferences never spreads raw input");

// ── sanitize at runtime: foreign/junk keys in content-type styles ──
import { sanitizeContentTypeStyles } from "../../src/lib/scripture-design";
assert.deepEqual(sanitizeContentTypeStyles({ song: "x'; drop table themes;--", scripture: "11111111-2222-3333-4444-555555555555", layersV2: true }), { scripture: "11111111-2222-3333-4444-555555555555" }); n++;

// ── migration SQL: additive, idempotent, rollback first ──
const sql = readFileSync("docs/migrations/2026-09-17-add-church-preferences-styles.sql", "utf8");
const rollbackAt = sql.indexOf("ROLLBACK");
const firstStmt = sql.search(/^ALTER TABLE/m);
ok(rollbackAt >= 0 && rollbackAt < firstStmt, "rollback written first");
ok(sql.slice(rollbackAt, firstStmt).split("\n").filter((l) => /DROP|ALTER PUBLICATION/.test(l)).every((l) => l.trim().startsWith("--")), "rollback is fully commented");
for (const col of ["content_type_styles jsonb NOT NULL DEFAULT '{}'::jsonb", "scripture_style jsonb", "scripture_style_updated_at timestamptz", "content_type_styles_updated_at timestamptz"]) {
  ok(sql.includes(`ADD COLUMN IF NOT EXISTS ${col}`), `idempotent add: ${col}`);
}
const live = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
ok(!/\bDROP\b|\bDELETE\b|\bUPDATE\b|\bTRUNCATE\b/i.test(live), "no destructive statements outside the rollback comment");
ok((live.match(/NOT VALID/g) ?? []).length === 2, "both CHECK constraints NOT VALID");
ok(/IF NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE conname = 'church_preferences_content_type_styles_object'\)/.test(live), "constraint add guarded");
ok(/NOT EXISTS \(SELECT 1 FROM pg_publication_tables[\s\S]*ALTER PUBLICATION supabase_realtime ADD TABLE public\.church_preferences/.test(live), "publication add guarded by pg_publication_tables");

// ── schema + client never uploads the '.default' legacy key ──
const schema = readFileSync("src/lib/db/schema.ts", "utf8");
ok(/contentTypeStyles: jsonb\("content_type_styles"\)\.notNull\(\)\.default\(\{\}\)/.test(schema), "schema: content_type_styles");
ok(/scriptureStyleUpdatedAt: timestamp\("scripture_style_updated_at", \{ withTimezone: true \}\)/.test(schema), "schema: updated_at");
const sync = readFileSync("src/lib/church-styles-sync.ts", "utf8");
ok(/churchId \? readLegacyScriptureStyle\(churchId\) : null/.test(sync), "migration reads only the church's own legacy key");
ok(/api\.setScripture\(legacyScripture, \{ ifEmpty: true, expectedChurchId: churchId \}\)/.test(sync) && /api\.setCts\(legacyCts, \{ ifEmpty: true, expectedChurchId: churchId \}\)/.test(sync), "migration uses ifEmpty");
ok(/MIGRATED_KEY\(churchId\)/.test(sync), "migration marker per church");
ok(/if \(done\) \{ try \{ window\.localStorage\.setItem\(MIGRATED_KEY/.test(sync) && !/Not permitted"\)\) done = false/.test(sync), "marker only set when every step settled (no refused-but-marked carve-out)");
ok(/r\.data\.churchId === churchId\) \{\n      hydrateChurchStyles/.test(sync), "refetch stores only under the session church returned by the server");
ok(/expectedChurchId: churchId/.test(sync), "queued writes carry the expected church");
ok(/CHURCH_STYLES_POLL_MS = 60_000/.test(sync) && /setInterval\([\s\S]{0,120}visibilityState !== "hidden"/.test(sync), "60s visible-only refetch backstop");
ok(!/sendSlideToLive|onSendSlideToLive|router\.refresh/.test(sync), "sync never re-sends the live slide / refreshes the router");
ok(/restorePendingWrites\(churchId, rec\.pending\)/.test(sync), "offline pending writes restored on load");
const operate = readFileSync("src/app/services/[id]/operate/page.tsx", "utf8");
ok(/initialChurchStyles=\{churchStylesSnapshotFromPrefs\(prefs\)\}/.test(operate), "operate page passes a snapshot even with no prefs row");

// ── realtime: no router.refresh / live re-send for style changes ──
const bridge = readFileSync("src/components/layout/RealtimeSyncBridge.tsx", "utf8");
const line = bridge.split("\n").find((l) => l.includes('table: "church_preferences"')) ?? "";
ok(/filter \}/.test(line) && /refreshChurchStylesFromServer\(churchId\)/.test(line) && !/scheduleRefresh/.test(line), "church_preferences → styles refetch only, church-filtered");

// ── picker disabled up front: server pages pass the session capability ──
for (const f of ["src/app/(app)/operator/page.tsx", "src/app/services/[id]/operate/page.tsx"]) {
  ok(/canEditLibrary=\{hasCap\(user\.role, "edit_library"\)\}/.test(readFileSync(f, "utf8")), `${f} passes canEditLibrary from the session`);
}
const oc = readFileSync("src/components/operator/OperatorConsole.tsx", "utf8");
ok(/setCanEditLibrary\(churchId, canEditLibrary\)/.test(oc), "OperatorConsole records the capability in the first render");
const tm = readFileSync("src/components/library/ThemesManager.tsx", "utf8");
ok(/setDenied\(isContentTypeEditDenied\(\)\)/.test(tm) && /disabled=\{denied\}/.test(tm), "picker disabled when denied (up front or after refusal)");
const note = readFileSync("changes/church-styles.md", "utf8");
ok(/within about a minute/.test(note) && !/few seconds/.test(note), "What's New promises about a minute, not seconds");

console.log(`church-styles-scope: ${n} assertions passed`);
