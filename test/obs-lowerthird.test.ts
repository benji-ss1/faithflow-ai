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
  isValidObsBand,
  livestreamRenderPlan,
  placementToTop,
  topToPlacement,
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
check("URL params round-trip through parseObsBand (incl. style + opacity)", () => {
  const cfg = { topPct: 55, heightPct: 26, fontScale: 1.25, opacity: 0.4, style: "gradient" as const };
  const qs = new URLSearchParams(obsBandParams(cfg));
  const back = parseObsBand((k) => qs.get(k));
  assert.equal(back.topPct, 55);
  assert.equal(back.heightPct, 26);
  assert.equal(back.fontScale, 1.25);
  assert.equal(Math.round(back.opacity * 100), 40);
  assert.equal(back.style, "gradient");
});

check("opacity slider controls the band paint transparency", () => {
  assert.equal(obsBandWire({ ...DEFAULT_OBS_BAND, style: "grey", opacity: 0.3 }).opacity, 0.3);
  assert.equal(obsBandWire({ ...DEFAULT_OBS_BAND, style: "black", opacity: 0.9 }).opacity, 0.9);
});

check("near-zero opacity drops the paint (legible white text over camera)", () => {
  const w = obsBandWire({ ...DEFAULT_OBS_BAND, style: "frost", opacity: 0 });
  assert.equal(w.color, undefined, "paint dropped at opacity 0");
  assert.equal(w.textColor, undefined, "dark frost text colour dropped → renderer forces white");
  assert.equal(w.opacity, undefined);
  // A normal opacity keeps the paint.
  assert.equal(obsBandWire({ ...DEFAULT_OBS_BAND, style: "frost", opacity: 0.5 }).color, "#ffffff");
});

check("theme style mirrors the church theme colours (bg + text)", () => {
  const w = obsBandWire({ ...DEFAULT_OBS_BAND, style: "theme", opacity: 0.8 }, { bgColor: "#123456", bgColor2: "#654321", bgAngle: 90, textColor: "#ffcc00" });
  assert.equal(w.color, "#123456");
  assert.equal(w.color2, "#654321");
  assert.equal(w.angle, 90);
  assert.equal(w.opacity, 0.8);
  assert.equal(w.textColor, "#ffcc00");
});

check("theme style with no explicit text colour → no textColor (renderer auto-contrasts)", () => {
  const w = obsBandWire({ ...DEFAULT_OBS_BAND, style: "theme" }, { bgColor: "#ffffff" });
  assert.equal(w.color, "#ffffff");
  assert.equal(w.textColor, undefined);
});

check("theme style with an image/none theme bg → neutral scrim, white text", () => {
  const w = obsBandWire({ ...DEFAULT_OBS_BAND, style: "theme" }, { textColor: "#333333" }); // no bgColor
  assert.equal(w.color, "#000000");
  assert.equal(w.textColor, undefined); // dropped — would be illegible on the scrim
});

check("isValidObsBand accepts a good config, rejects junk", () => {
  assert.equal(isValidObsBand(DEFAULT_OBS_BAND), true);
  assert.equal(isValidObsBand({ topPct: 70, heightPct: 24, fontScale: 1, opacity: 0.6, style: "theme" }), true);
  assert.equal(isValidObsBand({ topPct: 70, heightPct: 24, fontScale: 1, opacity: 0.6, style: "rainbow" }), false);
  assert.equal(isValidObsBand({ topPct: "x", heightPct: 24, fontScale: 1, opacity: 0.6, style: "grey" }), false);
  assert.equal(isValidObsBand(null), false);
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

check("Position placement gives FULL range: 100 = flush bottom for any height", () => {
  // The operator's core complaint: push the words to the very bottom.
  for (const h of [10, 24, 40, 60]) {
    const topAtBottom = placementToTop(100, h);
    assert.equal(topAtBottom + h, 100, `height ${h}: band bottom not flush (${topAtBottom}+${h})`);
    assert.equal(placementToTop(0, h), 0, `height ${h}: placement 0 not at top`);
  }
});

check("placement round-trips through topToPlacement", () => {
  assert.equal(topToPlacement(placementToTop(100, 24), 24), 100);
  assert.equal(topToPlacement(placementToTop(0, 24), 24), 0);
  assert.equal(topToPlacement(placementToTop(50, 30), 30), 50);
});

check("lowering height keeps the words at the bottom (placement stable)", () => {
  // Operator sets position to bottom (100) with a tall band, then slims the band —
  // the words should STAY at the bottom, not jump up.
  const tall = clampObsBand({ ...DEFAULT_OBS_BAND, heightPct: 50, topPct: placementToTop(100, 50) });
  const place = topToPlacement(tall.topPct, tall.heightPct);
  const slim = clampObsBand({ ...tall, heightPct: 20, topPct: placementToTop(place, 20) });
  assert.equal(slim.topPct + slim.heightPct, 100, "still flush bottom after slimming");
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

check("livestream lower_third: operator line1/line2 take priority over lyrics", () => {
  const lyric: SlidePayload = { kind: "text", text: "Amazing grace" };
  const p = livestreamRenderPlan("lower_third", lyric, { line1: "Pastor John", line2: "Lead Pastor" }, DEFAULT_OBS_BAND);
  assert.equal(p.renderSlide.kind, "text");
  const t = (p.renderSlide as { text: string }).text;
  assert.ok(t.includes("Pastor John") && t.includes("Lead Pastor") && !t.includes("Amazing"));
  assert.equal((p.renderSlide as { scriptureLayout?: string }).scriptureLayout, "lowerThird");
  const only1 = livestreamRenderPlan("lower_third", lyric, { line1: "Welcome", line2: "" }, DEFAULT_OBS_BAND);
  assert.equal((only1.renderSlide as { text: string }).text, "Welcome");
});
check("livestream lower_third: no operator lines -> lyrics in band; no backdrop/overlays", () => {
  const lyric: SlidePayload = { kind: "text", text: "Amazing grace" };
  for (const lt of [null, { line1: "  ", line2: "x" }]) {
    const p = livestreamRenderPlan("lower_third", lyric, lt, DEFAULT_OBS_BAND);
    assert.equal((p.renderSlide as { text: string }).text, "Amazing grace");
    assert.equal(p.showBackdrop, false);
    assert.equal(p.showFullOverlays, false);
  }
});
check("livestream full mode is a pass-through", () => {
  const lyric: SlidePayload = { kind: "text", text: "Amazing grace" };
  const p = livestreamRenderPlan("full", lyric, { line1: "Pastor John", line2: "" }, DEFAULT_OBS_BAND);
  assert.equal(p.renderSlide, lyric);
  assert.equal(p.showBackdrop, true);
  assert.equal(p.showFullOverlays, true);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
