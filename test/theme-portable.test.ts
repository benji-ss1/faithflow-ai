/**
 * Portable theme file (.pftheme.json) — round-trip + hostile-input tests for the
 * pure helpers in src/lib/theme-portable.ts.
 *
 * Run: npx tsx test/theme-portable.test.ts
 */
import assert from "node:assert/strict";
import {
  toPortableTheme, parsePortableTheme, applyPortableMedia, tidyAfterMediaDrop,
  isSafeS3Key, keyBelongsToChurch, isKnownMediaPath, missingMediaMessage,
  PFTHEME_FORMAT, PFTHEME_VERSION, MAX_THEME_FILE_BYTES,
} from "../src/lib/theme-portable";
import { sanitizeThemeConfig } from "../src/lib/theme-config";
import type { ThemeConfig } from "../src/lib/theme-config";

let n = 0;
const ok = (cond: unknown, msg: string) => { assert.ok(cond, msg); n++; };

const CHURCH_A = "11111111-1111-1111-1111-111111111111";
const CHURCH_B = "22222222-2222-2222-2222-222222222222";

const keyA = `${CHURCH_A}/media/aaaaaaaa-1111-2222-3333-444444444444.jpg`;
const keyA2 = `${CHURCH_A}/media/bbbbbbbb-1111-2222-3333-444444444444.mp4`;
const keyB = `${CHURCH_B}/media/cccccccc-1111-2222-3333-444444444444.jpg`;

const signed = (key: string) => `https://s3.example.com/bucket/${key}?X-Amz-Signature=deadbeef`;
/** Stand-in for s3.keyFromPresignedUrl (which needs S3 env configured). */
const toKey = (url: string): string | null => {
  const m = /^https:\/\/s3\.example\.com\/bucket\/([^?]+)\?X-Amz-Signature=/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
};

function themeWithMedia(): ThemeConfig {
  return {
    fontFamily: "Inter",
    fontSizePx: 64,
    textColor: "#ffffff",
    bgType: "image",
    bgColor: "#101010",
    bgImageUrl: signed(keyA),
    bgVideoUrl: signed(keyA2),
    logoUrl: signed(keyA),
    scriptureShowReference: true,
    scriptureReferencePosition: "below",
    layout: {
      version: 3,
      slides: [{
        id: "s1",
        name: "Lyrics",
        role: "lyrics",
        bgColor: "#000000",
        bgImageUrl: signed(keyA),
        objects: [
          { id: "t1", kind: "text", role: "main", x: 5, y: 40, w: 90, h: 20, text: "Lyrics" },
          { id: "i1", kind: "image", x: 0, y: 0, w: 100, h: 100, url: signed(keyA) },
        ],
      }],
    },
  } as ThemeConfig;
}

// ── 1. Export strips every signed URL, keeps a manifest ──────────────────────
{
  const { file, unresolved } = toPortableTheme("Sunday", themeWithMedia(), toKey, { churchId: CHURCH_A });
  const json = JSON.stringify(file);
  ok(file.format === PFTHEME_FORMAT && file.version === PFTHEME_VERSION, "export carries the format envelope");
  ok(file.name === "Sunday", "export carries the name");
  ok(!json.includes("X-Amz-Signature"), "NO signed URL survives into the exported file");
  ok(!json.includes("s3.example.com"), "no storage host survives into the exported file");
  ok(unresolved.length === 0, "every media reference was keyed cleanly");
  const paths = file.media.map((m) => m.path).sort();
  assert.deepEqual(paths, [
    "bgImageUrl", "bgVideoUrl", "layout.slides.0.bgImageUrl",
    "layout.slides.0.objects.1.url", "logoUrl",
  ]);
  n++;
  ok(file.media.every((m) => isSafeS3Key(m.s3Key)), "manifest keys are stable object keys");
  ok(file.media.find((m) => m.path === "bgVideoUrl")?.kind === "video", "video kind preserved");
  // The image OBJECT stays in the layout as a url-less placeholder so the
  // manifest index still addresses it.
  const objs = (file.config.layout!.slides[0].objects) as Record<string, unknown>[];
  ok(objs.length === 2 && objs[1].url === undefined, "layout image object is kept as a placeholder on export");
  ok(file.config.bgType === "image", "export does not downgrade bgType (import restores or downgrades)");
}

// ── 2. Round-trip inside the SAME church is identical ────────────────────────
{
  const original = themeWithMedia();
  const { file } = toPortableTheme("Sunday", original, toKey, { churchId: CHURCH_A });
  const parsed = parsePortableTheme(JSON.parse(JSON.stringify(file)), toKey);
  ok(parsed.ok, "exported file parses");
  assert.ok(parsed.ok);
  // Same church → every key resolves back to a URL.
  const { config, missing } = applyPortableMedia(parsed.data.config, parsed.data.media, (ref) =>
    keyBelongsToChurch(ref.s3Key, CHURCH_A) ? signed(ref.s3Key) : null);
  ok(missing.length === 0, "same-church round trip loses no media");
  assert.deepEqual(sanitizeThemeConfig(config).config, sanitizeThemeConfig(original).config);
  n++;
  ok(parsed.data.name === "Sunday", "name round-trips");
}

// ── 3. Cross-church import drops the media and REPORTS it ────────────────────
{
  const { file } = toPortableTheme("Sunday", themeWithMedia(), toKey, { churchId: CHURCH_A });
  const parsed = parsePortableTheme(file, toKey);
  assert.ok(parsed.ok);
  const { config, missing } = applyPortableMedia(parsed.data.config, parsed.data.media, (ref) =>
    keyBelongsToChurch(ref.s3Key, CHURCH_B) ? signed(ref.s3Key) : null);
  const out = sanitizeThemeConfig(config).config;
  const json = JSON.stringify(out);
  ok(!json.includes(CHURCH_A), "church A's storage key is nowhere in the imported theme");
  ok(!json.includes("X-Amz-Signature"), "no signed URL survives a cross-church import");
  ok(out.bgImageUrl === undefined && out.bgVideoUrl === undefined && out.logoUrl === undefined, "foreign media fields are cleared, not left dangling");
  ok(out.bgType === "solid", "bgType downgraded to solid so the slide still renders");
  ok(out.bgColor === "#101010", "the solid colour survives — the look degrades, it doesn't break");
  ok(out.layout?.slides[0].bgImageUrl === undefined, "layout slide background cleared");
  ok(out.layout?.slides[0].objects.length === 1, "the picture-less image box is removed, the text box stays");
  ok(missing.length === 5, "every dropped picture is reported");
  ok(missingMediaMessage(missing).includes("choose your own background"), "the message tells a volunteer what to do");
  ok(missingMediaMessage([]) === "", "nothing missing → no message");
  // Non-media settings come across untouched.
  ok(out.fontFamily === "Inter" && out.fontSizePx === 64 && out.scriptureShowReference === true, "fonts/colours/scripture options cross churches fine");
}

// ── 4. Legacy { name, config } files still import (rule 0) ───────────────────
{
  const legacy = { name: "Old theme", config: { bgType: "image", bgColor: "#222222", bgImageUrl: signed(keyA), fontFamily: "Lora" } };
  const parsed = parsePortableTheme(legacy, toKey);
  assert.ok(parsed.ok);
  ok(parsed.data.name === "Old theme", "legacy name read");
  ok(parsed.data.media.length === 1 && parsed.data.media[0].s3Key === keyA, "legacy inline URL lifted into the manifest");
  ok((parsed.data.config as Record<string, unknown>).bgImageUrl === undefined, "legacy inline signed URL is NOT left in the config");
  ok((parsed.data.config as Record<string, unknown>).fontFamily === "Lora", "legacy non-media settings kept");
  // Same church → restored.
  const same = applyPortableMedia(parsed.data.config, parsed.data.media, (r) => keyBelongsToChurch(r.s3Key, CHURCH_A) ? signed(r.s3Key) : null);
  ok(typeof same.config.bgImageUrl === "string", "legacy file round-trips in its own church");
  // Other church → dropped.
  const reparsed = parsePortableTheme(legacy, toKey);
  assert.ok(reparsed.ok);
  const other = applyPortableMedia(reparsed.data.config, reparsed.data.media, () => null);
  ok(other.config.bgImageUrl === undefined && other.config.bgType === "solid", "legacy file in another church drops the picture");
}

// ── 5. A legacy file carrying a FOREIGN signed URL never keeps it ────────────
{
  const hostile = { name: "Borrowed", config: { bgType: "image", bgImageUrl: signed(keyB), logoUrl: "https://evil.example.com/logo.png" } };
  const parsed = parsePortableTheme(hostile, toKey);
  assert.ok(parsed.ok);
  const { config, missing } = applyPortableMedia(parsed.data.config, parsed.data.media, (r) => keyBelongsToChurch(r.s3Key, CHURCH_A) ? signed(r.s3Key) : null);
  const json = JSON.stringify(config);
  ok(!json.includes(CHURCH_B), "another church's key is dropped");
  ok(!json.includes("evil.example.com"), "an outside host is dropped, not carried into the theme");
  ok(missing.length >= 1 && parsed.data.unresolved.length === 1, "both are reported (the outside host as unresolved)");
}

// ── 6. Hostile files ─────────────────────────────────────────────────────────
{
  // Wrong / missing shape
  ok(!parsePortableTheme(null, toKey).ok, "null rejected");
  ok(!parsePortableTheme([], toKey).ok, "array rejected");
  ok(!parsePortableTheme({ name: "x" }, toKey).ok, "no config rejected");
  ok(!parsePortableTheme({ format: "propresenter.theme", config: {} }, toKey).ok, "foreign format marker rejected");
  ok(!parsePortableTheme({ format: PFTHEME_FORMAT, version: 99, config: {} }, toKey).ok, "future version rejected with a clear message");
  const fut = parsePortableTheme({ format: PFTHEME_FORMAT, version: 99, config: {} }, toKey);
  ok(!fut.ok && /newer version/.test(fut.error), "future-version error is plain English");
  ok(!parsePortableTheme("{not json", toKey).ok, "unparseable string rejected");
  ok(!parsePortableTheme("x".repeat(MAX_THEME_FILE_BYTES + 1), toKey).ok, "oversized string rejected before JSON.parse");

  // Prototype pollution
  const poison = JSON.parse('{"format":"presentflow.theme","version":1,"name":"p","config":{"__proto__":{"polluted":true},"constructor":{"x":1},"bgColor":"#fff"}}');
  const p = parsePortableTheme(poison, toKey);
  assert.ok(p.ok);
  const clean = sanitizeThemeConfig(p.data.config).config;
  ok(({} as Record<string, unknown>).polluted === undefined, "Object.prototype is not polluted");
  ok(!Object.keys(clean).some((k) => k === "__proto__" || k === "constructor"), "pollution keys are not persisted");
  ok(clean.bgColor === "#fff", "the legitimate key still saves");

  // Poisoned layout
  const poisonLayout = JSON.parse('{"format":"presentflow.theme","version":1,"config":{"layout":{"version":3,"slides":[{"id":"a","name":"n","__proto__":{"x":1},"objects":[]}]}}}');
  const pl = parsePortableTheme(poisonLayout, toKey);
  assert.ok(pl.ok);
  ok(sanitizeThemeConfig(pl.data.config).config.layout?.slides.length === 0, "a polluted layout slide is dropped by the layout validator");

  // javascript: / data:svg / foreign same-origin URLs in media slots
  for (const bad of ["javascript:alert(1)", "data:image/svg+xml;base64,PHN2Zz4=", "/api/auth/device-exchange?token=x", "//evil.example.com/x.png", "file:///etc/passwd"]) {
    const r = parsePortableTheme({ format: PFTHEME_FORMAT, version: 1, config: { bgType: "image", bgImageUrl: bad } }, toKey);
    assert.ok(r.ok);
    const { config } = applyPortableMedia(r.data.config, r.data.media, () => null);
    const out = sanitizeThemeConfig(config).config;
    ok(out.bgImageUrl === undefined, `hostile URL rejected: ${bad}`);
  }

  // A hostile MANIFEST cannot write anywhere it likes, or smuggle a key.
  const hostileManifest = parsePortableTheme({
    format: PFTHEME_FORMAT, version: 1, name: "m", config: { bgColor: "#000" },
    media: [
      { path: "__proto__.polluted", kind: "image", s3Key: keyA },
      { path: "constructor.prototype.x", kind: "image", s3Key: keyA },
      { path: "bgImageUrl", kind: "image", s3Key: `${CHURCH_A}/media/../../${CHURCH_B}/media/x.jpg` },
      { path: "bgImageUrl", kind: "image", s3Key: 42 },
      { path: "layout.slides.9999999.bgImageUrl", kind: "image", s3Key: keyA },
    ],
  }, toKey);
  assert.ok(hostileManifest.ok);
  ok(hostileManifest.data.media.length === 0, "every hostile manifest entry is refused");
  ok(({} as Record<string, unknown>).polluted === undefined, "hostile manifest did not pollute Object.prototype");
  ok(!isKnownMediaPath("__proto__.polluted") && !isKnownMediaPath("layout.slides.9999999.bgImageUrl"), "only known media paths are writable");

  // Manifest entry count is capped.
  const many = parsePortableTheme({
    format: PFTHEME_FORMAT, version: 1, config: {},
    media: Array.from({ length: 5000 }, () => ({ path: "bgImageUrl", kind: "image", s3Key: keyA })),
  }, toKey);
  assert.ok(many.ok);
  ok(many.data.media.length <= 64, "manifest is capped at 64 entries");
}

// ── 7. Key safety helpers ────────────────────────────────────────────────────
{
  ok(isSafeS3Key(keyA), "a real key is accepted");
  ok(!isSafeS3Key(`${CHURCH_A}/media/../../x.jpg`), "dot segments rejected");
  ok(!isSafeS3Key(`/${CHURCH_A}/media/x.jpg`), "absolute key rejected");
  ok(!isSafeS3Key(`${CHURCH_A}\\media\\x.jpg`), "backslash rejected");
  ok(!isSafeS3Key(`${CHURCH_A}/media/x.jpg` + "A".repeat(400)), "oversized key rejected");
  ok(!isSafeS3Key(null) && !isSafeS3Key(42) && !isSafeS3Key({}), "non-strings rejected");
  ok(keyBelongsToChurch(keyA, CHURCH_A) && !keyBelongsToChurch(keyA, CHURCH_B), "ownership is decided by the key prefix");
  ok(!keyBelongsToChurch(keyA, ""), "an empty church id owns nothing");
  // The classic near-miss: a church id that is a PREFIX of another.
  ok(!keyBelongsToChurch(`${CHURCH_A}x/media/a.jpg`, CHURCH_A), "a prefix-similar church id is not the owner");
}

// ── 8. tidyAfterMediaDrop is safe on junk ────────────────────────────────────
{
  const c: Record<string, unknown> = { layout: { version: 3, slides: [null, { objects: [null, { kind: "image" }, { kind: "text", id: "t" }] }] }, bgType: "video" };
  tidyAfterMediaDrop(c);
  const slides = (c.layout as { slides: Record<string, unknown>[] }).slides;
  ok((slides[1].objects as unknown[]).length === 1, "url-less media boxes removed, text kept");
  ok(c.bgType === "solid", "a video background with no video downgrades");
}

console.log(`theme-portable: ${n} assertions passed`);
