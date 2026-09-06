/**
 * OBS lower-third overlay helpers (2026-09-06 field request, IMG_5489).
 *
 * Locks the contract that the OBS setup card + /livestream share: geometry
 * round-trips through the URL, is clamped to the renderer's valid band ranges,
 * and overlayBandSlide wraps ANY live text (plain song / designed song /
 * scripture) into a valid lower-third caption while turning media into an empty
 * slide (no full-frame picture over the broadcast). It must NOT mutate its input
 * (the operator's live slide) — that's the "OBS never touches the projector" line.
 *
 * Run: npx tsx test/obs-lowerthird.test.ts
 */
import assert from "node:assert/strict";
import {
  DEFAULT_OBS_BAND,
  OBS_BAND_STYLES,
  clampObsBand,
  obsBandParams,
  parseObsBand,
  obsBandWire,
  bandableTextOf,
  overlayBandSlide,
} from "../src/lib/obs-lowerthird";
import { slideOutputIdentity, type SlidePayload } from "../src/lib/broadcast";

// Mirror of broadcast.ts COLOR_RE (hex or rgb/rgba) so the test confirms every
// style's colours are wire-valid.
const colorOk = (c: string) => /^(?:#[0-9a-fA-F]{3,8}|rgba?\(\s*\d+(?:\s*,\s*\d+){2}\s*(?:,\s*(?:0|1|0?\.\d+))?\s*\))$/.test(c);

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}

// A local mirror of broadcast.ts isValidScriptureBand ranges so the test is
// self-contained about what the renderer will accept.
function bandInRange(b: { topPct?: number; heightPct?: number; fontScale?: number; opacity?: number }): boolean {
  const ok = (v: number | undefined, lo: number, hi: number) => v === undefined || (Number.isFinite(v) && v >= lo && v <= hi);
  return ok(b.topPct, 0, 100) && ok(b.heightPct, 1, 100) && ok(b.fontScale, 0.1, 4) && ok(b.opacity, 0, 1);
}

console.log("OBS lower-third helpers");

// --- geometry ---------------------------------------------------------------
check("URL params round-trip through parseObsBand (incl. style)", () => {
  const cfg = { topPct: 55, heightPct: 26, fontScale: 1.25, style: "gradient" as const };
  const qs = new URLSearchParams(obsBandParams(cfg));
  const back = parseObsBand((k) => qs.get(k));
  assert.equal(back.topPct, 55);
  assert.equal(back.heightPct, 26);
  assert.equal(back.fontScale, 1.25);
  assert.equal(back.style, "gradient");
});

check("parseObsBand with no params → defaults", () => {
  assert.deepEqual(parseObsBand(() => null), DEFAULT_OBS_BAND);
});

check("parseObsBand ignores an unknown style → default style", () => {
  const back = parseObsBand((k) => (k === "ltStyle" ? "rainbow" : null));
  assert.equal(back.style, DEFAULT_OBS_BAND.style);
});

check("clampObsBand pins out-of-range values", () => {
  const c = clampObsBand({ topPct: 999, heightPct: -5, fontScale: 50 });
  assert.ok(c.topPct >= 0);
  assert.ok(c.heightPct >= 10 && c.heightPct <= 60);
  assert.ok(c.fontScale >= 0.5 && c.fontScale <= 2);
});

check("clampObsBand cross-clamps so the band never runs off the bottom", () => {
  // topPct 92 + heightPct 60 would be 152%; top must be pulled to <= 100-height.
  const c = clampObsBand({ topPct: 92, heightPct: 60 });
  assert.ok(c.topPct + c.heightPct <= 100, `band overruns: ${c.topPct}+${c.heightPct}`);
});

check("clampObsBand tolerates garbage (NaN) → defaults", () => {
  const c = clampObsBand({ topPct: NaN, heightPct: Infinity, fontScale: NaN });
  assert.deepEqual(c, DEFAULT_OBS_BAND);
});

check("obsBandWire always lands inside the renderer's valid ranges — every style", () => {
  for (const style of OBS_BAND_STYLES) {
    for (const geo of [{ topPct: 0, heightPct: 60 }, { topPct: 92, heightPct: 10 }, { topPct: 66, heightPct: 30 }]) {
      const w = obsBandWire(clampObsBand({ ...geo, fontScale: 1, style }));
      assert.ok(bandInRange(w), `wire out of range for ${style} ${JSON.stringify(geo)}`);
      if (w.color !== undefined) assert.ok(colorOk(w.color), `bad color ${w.color}`);
      if (w.color2 !== undefined) assert.ok(colorOk(w.color2), `bad color2 ${w.color2}`);
    }
  }
});

check("style 'clear' → transparent band (no paint); others paint", () => {
  assert.equal(obsBandWire({ ...DEFAULT_OBS_BAND, style: "clear" }).color, undefined);
  assert.equal(obsBandWire({ ...DEFAULT_OBS_BAND, style: "grey" }).color, "#4b5563");
  assert.equal(obsBandWire({ ...DEFAULT_OBS_BAND, style: "black" }).color, "#000000");
  const g = obsBandWire({ ...DEFAULT_OBS_BAND, style: "gradient" });
  assert.equal(g.color, "#000000"); assert.equal(g.color2, "rgba(0,0,0,0)");
  assert.equal(obsBandWire({ ...DEFAULT_OBS_BAND, style: "frost" }).color, "#ffffff");
});

// --- bandableTextOf / overlayBandSlide --------------------------------------
const plainSong: SlidePayload = { kind: "text", text: "He reigns forever more" };
const designedSong: SlidePayload = { kind: "text", text: "", objects: [
  { kind: "text", x: 0, y: 0, w: 100, h: 100, text: "Great is Thy" },
  { kind: "text", x: 0, y: 0, w: 100, h: 100, text: "faithfulness" },
] };
const verse: SlidePayload = { kind: "text", text: "For God so loved the world", reference: "John 3:16 (NKJV)" };

check("bandableTextOf: plain text", () => assert.equal(bandableTextOf(plainSong), "He reigns forever more"));
check("bandableTextOf: designed song flattens object text", () => assert.equal(bandableTextOf(designedSong), "Great is Thy\nfaithfulness"));

check("overlayBandSlide wraps a plain song into a lowerThird caption", () => {
  const s = overlayBandSlide(plainSong, DEFAULT_OBS_BAND) as Extract<SlidePayload, { kind: "text" }>;
  assert.equal(s.kind, "text");
  assert.equal(s.scriptureLayout, "lowerThird");
  assert.equal(s.text, "He reigns forever more");
  assert.ok(s.scriptureBand);
});

check("overlayBandSlide keeps a scripture reference for the band footer", () => {
  const s = overlayBandSlide(verse, DEFAULT_OBS_BAND) as Extract<SlidePayload, { kind: "text" }>;
  assert.equal(s.reference, "John 3:16 (NKJV)");
  assert.equal(s.scriptureLayout, "lowerThird");
});

check("overlayBandSlide flattens a designed song (no lyrics lost)", () => {
  const s = overlayBandSlide(designedSong, DEFAULT_OBS_BAND) as Extract<SlidePayload, { kind: "text" }>;
  assert.equal(s.text, "Great is Thy\nfaithfulness");
  assert.equal(s.scriptureLayout, "lowerThird");
});

check("overlayBandSlide → empty for media / logo / empty (no picture over the broadcast)", () => {
  assert.deepEqual(overlayBandSlide({ kind: "image", url: "https://x/y.jpg" }, DEFAULT_OBS_BAND), { kind: "empty" });
  assert.deepEqual(overlayBandSlide({ kind: "video", url: "https://x/y.mp4" }, DEFAULT_OBS_BAND), { kind: "empty" });
  assert.deepEqual(overlayBandSlide({ kind: "empty" }, DEFAULT_OBS_BAND), { kind: "empty" });
});

check("overlayBandSlide → empty for a blank/whitespace text slide", () => {
  assert.deepEqual(overlayBandSlide({ kind: "text", text: "   " }, DEFAULT_OBS_BAND), { kind: "empty" });
});

check("overlayBandSlide does NOT mutate the operator's live slide", () => {
  const original: SlidePayload = { kind: "text", text: "hold me", reference: "Ps 23:1" };
  const snapshot = JSON.stringify(original);
  overlayBandSlide(original, DEFAULT_OBS_BAND);
  assert.equal(JSON.stringify(original), snapshot, "input slide was mutated");
});

check("the wrapped caption is a valid renderable text slide (stable identity)", () => {
  const s = overlayBandSlide(plainSong, DEFAULT_OBS_BAND);
  // slideOutputIdentity must not throw and must be deterministic.
  assert.equal(slideOutputIdentity(s), slideOutputIdentity(overlayBandSlide(plainSong, DEFAULT_OBS_BAND)));
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
