/**
 * ADVERSARIAL — exportTheme / importTheme tenant scoping + capability gates.
 *
 * The threat this locks down: a theme's background/logo is a SIGNED S3 URL whose
 * object key is `{churchId}/…`. An exported theme file is a shareable artifact,
 * so (a) it must never carry a live signed URL out of the exporting church, and
 * (b) an imported file must never leave a link into the church that made it.
 *
 * Source assertions + pure-helper checks (no DB), same style as
 * theme-gaps-scope.test.ts.
 *
 * Run: npx tsx test/adversarial/theme-portable-scope.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  toPortableTheme, parsePortableTheme, applyPortableMedia,
  keyBelongsToChurch, isKnownMediaPath, isSafeS3Key, PFTHEME_FORMAT,
} from "../../src/lib/theme-portable";
import { sanitizeThemeConfig } from "../../src/lib/theme-config";

const src = readFileSync("src/lib/actions.ts", "utf8");
function body(name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const next = src.indexOf("\nexport async function ", start + 10);
  return src.slice(start, next < 0 ? undefined : next);
}
let n = 0;
const ok = (cond: unknown, msg: string) => { assert.ok(cond, msg); n++; };

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const keyA = `${A}/media/aaaaaaaa-1111-2222-3333-444444444444.jpg`;
const keyB = `${B}/media/bbbbbbbb-1111-2222-3333-444444444444.jpg`;
const signed = (k: string) => `https://s3.example.com/bucket/${k}?X-Amz-Signature=abc`;
const toKey = (u: string) => {
  const m = /^https:\/\/s3\.example\.com\/bucket\/([^?]+)\?X-Amz-Signature=/.exec(u);
  return m ? m[1] : null;
};

// ── exportTheme ──────────────────────────────────────────────────────────────
{
  const b = body("exportTheme");
  ok(/requireUser\(\)/.test(b), "export requires a signed-in user");
  ok(/eq\(themes\.id, id\), eq\(themes\.churchId, user\.churchId\)/.test(b), "export is church-scoped (another church's theme id returns Theme not found)");
  ok(/if \(!row\) return \{ ok: false, error: "Theme not found" \}/.test(b), "a foreign id is indistinguishable from a missing one");
  ok(/toPortableTheme\(/.test(b) && /keyFromPresignedUrl\(url\)/.test(b), "export routes media through the portable-theme keyer, never raw config");
  ok(/churchId: user\.churchId/.test(b), "the keyer is told whose church is exporting (foreign keys are refused)");
  ok(!/insert\(|update\(|delete\(/.test(b), "export writes nothing");
}

// ── importTheme ──────────────────────────────────────────────────────────────
{
  const b = body("importTheme");
  ok(/requireCap\("edit_library"\)/.test(b), "import is gated on edit_library");
  ok(/MAX_THEME_FILE_BYTES/.test(b), "import caps the file size before doing work");
  ok(/parsePortableTheme\(json, \(url\) => keyFromPresignedUrl\(url\)\)/.test(b), "import parses through the hardened parser (no raw config path)");
  ok(/if \(!keyBelongsToChurch\(ref\.s3Key, user\.churchId\)\) continue;/.test(b), "media is re-signed ONLY for keys this church owns");
  ok(/presignGet\(ref\.s3Key\)/.test(b), "a resolved key is re-signed server-side (the file never carries a URL)");
  ok(/sanitizeThemeConfig\(withMedia\)/.test(b), "everything imported is re-sanitised server-side");
  ok(!/allowBuiltinId/.test(b), "import NEVER allows builtinId — an import can't impersonate a built-in theme");
  ok(/insert\(themes\)\.values\(\{\s*churchId: user\.churchId/.test(b), "the created row belongs to the importing church");
  ok(/db\.insert\(themes\)/.test(b) && !/db\.update\(themes\)/.test(b), "import CREATES a new theme and never overwrites an existing one");
  ok(/missingMedia/.test(b), "dropped media is reported back to the caller, not swallowed");
}

// ── The invariant itself, exercised end to end on the pure helpers ───────────
{
  const cfg = { bgType: "image" as const, bgColor: "#123456", bgImageUrl: signed(keyA), logoUrl: signed(keyA), builtinId: "builtin:dark" };
  // 1. Church A exports.
  const { file } = toPortableTheme("Theirs", cfg, toKey, { churchId: A });
  const wire = JSON.stringify(file);
  ok(!wire.includes("X-Amz-Signature"), "exported bytes carry no signed URL");
  ok(file.format === PFTHEME_FORMAT, "exported bytes are self-describing");

  // 2. Church B imports the same bytes.
  const parsed = parsePortableTheme(JSON.parse(wire), toKey);
  assert.ok(parsed.ok);
  const resolvedForB = (ref: { s3Key: string }) => (keyBelongsToChurch(ref.s3Key, B) ? signed(ref.s3Key) : null);
  const { config, missing } = applyPortableMedia(parsed.data.config, parsed.data.media, resolvedForB);
  const saved = sanitizeThemeConfig(config).config;
  const savedJson = JSON.stringify(saved);
  ok(!savedJson.includes(A), "church A's id/key does not reach church B's saved theme");
  ok(!savedJson.includes("X-Amz-Signature"), "no signed URL reaches church B's saved theme");
  ok(saved.bgImageUrl === undefined && saved.logoUrl === undefined, "foreign media is dropped, never left dangling");
  ok(saved.bgType === "solid" && saved.bgColor === "#123456", "the theme still renders — it degrades, it doesn't break");
  ok(missing.length === 2, "both dropped pictures are reported");
  ok(saved.builtinId === undefined, "builtinId is stripped by the shared sanitizer on every import");

  // 3. Church A re-imports its own file → nothing is lost.
  const back = parsePortableTheme(JSON.parse(wire), toKey);
  assert.ok(back.ok);
  const mine = applyPortableMedia(back.data.config, back.data.media, (r) => (keyBelongsToChurch(r.s3Key, A) ? signed(r.s3Key) : null));
  ok(mine.missing.length === 0 && typeof mine.config.bgImageUrl === "string", "the owning church gets its own pictures back");
}

// ── Smuggling attempts ───────────────────────────────────────────────────────
{
  // Hand-edited file that tries to put a FOREIGN key straight into the manifest.
  const smuggle = { format: PFTHEME_FORMAT, version: 1, name: "x", config: {}, media: [{ path: "bgImageUrl", kind: "image", s3Key: keyB }] };
  const p = parsePortableTheme(smuggle, toKey);
  assert.ok(p.ok);
  ok(p.data.media.length === 1, "the parser keeps the entry (shape is valid)…");
  const { config, missing } = applyPortableMedia(p.data.config, p.data.media, (r) => (keyBelongsToChurch(r.s3Key, A) ? signed(r.s3Key) : null));
  ok(config.bgImageUrl === undefined && missing.length === 1, "…but the OWNERSHIP check at resolve time refuses it");

  // Key-shaped traversal / prefix attacks.
  ok(!isSafeS3Key(`${A}/media/../../${B}/media/x.jpg`), "a traversal key is refused outright");
  ok(!keyBelongsToChurch(`${A}-evil/media/x.jpg`, A), "a church id that merely starts with ours is not ours");
  ok(!keyBelongsToChurch(keyB, A), "another church's key is never ours");

  // A manifest path that tries to write outside the known media slots.
  for (const p2 of ["__proto__", "constructor.prototype.x", "layout.slides.0.objects.0.text", "../logoUrl", "logoUrl "]) {
    ok(!isKnownMediaPath(p2), `manifest path refused: ${p2}`);
  }
}

console.log(`theme-portable-scope (adversarial): ${n} assertions passed`);
