// applyChurchLayout — songs/plain-text pick up the church's lower-third band
// while scripture keeps its styling and per-slide overrides win.
// Run: npx tsx --env-file=.env.local test/song-layout.test.ts
import test from "node:test";
import assert from "node:assert/strict";

// Minimal localStorage stub so scriptureStyle's load/save (window-guarded) works.
// Set before any test runs; the module only reads `window` when its functions
// are called, so a static import is safe.
const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  },
  dispatchEvent: () => true,
};

import { applyChurchLayout, songLowerThirdPayload, sourceForRelayout, saveScriptureStyle, DEFAULT_SCRIPTURE_DESIGN } from "../src/components/operator/scripture/scriptureStyle";

const CHURCH = "church-1";
function setChurchLayout(layout: "fullscreen" | "lowerThird") {
  saveScriptureStyle(CHURCH, { ...DEFAULT_SCRIPTURE_DESIGN, layout });
}

test("song band helper produces a valid lower-third payload", () => {
  const p = songLowerThirdPayload("Amazing grace", DEFAULT_SCRIPTURE_DESIGN) as any;
  assert.equal(p.kind, "text");
  assert.equal(p.text, "Amazing grace");
  assert.equal(p.scriptureLayout, "lowerThird");
  assert.equal(p.reference, undefined, "song band carries no scripture reference");
});

test("default fullscreen → song slide is UNCHANGED", () => {
  setChurchLayout("fullscreen");
  const song = { kind: "text", text: "How great thou art" } as any;
  const out = applyChurchLayout(song, CHURCH) as any;
  assert.equal(out.scriptureLayout, undefined, "no band applied when church default is fullscreen");
  assert.equal(out, song, "same slide ref (no-op)");
});

test("default lowerThird → song lyrics get banded", () => {
  setChurchLayout("lowerThird");
  const song = { kind: "text", text: "How great thou art" } as any;
  const out = applyChurchLayout(song, CHURCH) as any;
  assert.equal(out.scriptureLayout, "lowerThird");
  assert.ok(out.scriptureBand, "band attached");
  assert.equal(out.text, "How great thou art");
  assert.equal(out.reference, undefined);
});

test("designed song (text in an object) is banded using the object text", () => {
  setChurchLayout("lowerThird");
  const designed = { kind: "text", text: "", objects: [{ kind: "text", x: 0, y: 0, w: 100, h: 100, text: "Blessed assurance" }] } as any;
  const out = applyChurchLayout(designed, CHURCH) as any;
  assert.equal(out.scriptureLayout, "lowerThird");
  assert.equal(out.text, "Blessed assurance");
});

test("designed song with MULTIPLE text objects bands ALL of them (no dropped lyrics)", () => {
  setChurchLayout("lowerThird");
  const designed = { kind: "text", text: "", objects: [
    { kind: "text", x: 0, y: 0, w: 100, h: 50, text: "Verse one line" },
    { kind: "text", x: 0, y: 50, w: 100, h: 50, text: "Verse two line" },
  ] } as any;
  const out = applyChurchLayout(designed, CHURCH) as any;
  assert.equal(out.scriptureLayout, "lowerThird");
  assert.ok(out.text.includes("Verse one line") && out.text.includes("Verse two line"), "both text objects preserved");
});

test("per-slide layout override is left untouched", () => {
  setChurchLayout("fullscreen");
  const overridden = { kind: "text", text: "x", scriptureLayout: "lowerThird", scriptureBand: { topPct: 70, heightPct: 30, fontScale: 1 } } as any;
  const out = applyChurchLayout(overridden, CHURCH);
  assert.equal(out, overridden, "explicit per-slide layout wins over church default");
});

test("scripture (has reference) still routes through scripture styling, not the song path", () => {
  setChurchLayout("lowerThird");
  const verse = { kind: "text", text: "For God so loved the world", reference: "John 3:16" } as any;
  const out = applyChurchLayout(verse, CHURCH) as any;
  assert.equal(out.scriptureLayout, "lowerThird", "verse banded per church default");
  // reference is preserved on the scripture path (footer shows it)
  assert.ok(typeof out.reference === "string" && out.reference.includes("John 3:16"));
});

test("media (image) untouched when church default is fullscreen (media banding covered in media-layout.test)", () => {
  setChurchLayout("fullscreen");
  const img = { kind: "image", url: "https://x/y.png", fit: "contain" } as any;
  const out = applyChurchLayout(img, CHURCH);
  assert.equal(out, img);
});

test("empty text → not banded (no crash)", () => {
  setChurchLayout("lowerThird");
  const blank = { kind: "text", text: "   " } as any;
  const out = applyChurchLayout(blank, CHURCH) as any;
  assert.equal(out.scriptureLayout, undefined);
});

// ---- LIVE TOGGLE reversal: sourceForRelayout must let applyChurchLayout re-derive
test("REVERSE a live-banded verse → sourceForRelayout reduces the pre-styled slide so re-apply un-bands it", () => {
  // A banded scripture slide as it is LIVE (has scriptureLayout + reference).
  const liveBanded = { kind: "text", text: "For God so loved", reference: "John 3:16", scriptureLayout: "lowerThird", scriptureBand: { topPct: 70, heightPct: 30, fontScale: 1 } } as any;
  const raw = sourceForRelayout(liveBanded) as any;
  assert.equal(raw.scriptureLayout, undefined, "band stripped");
  assert.equal(raw.reference, "John 3:16", "reference kept");
  // Now the church flips to FULL SCREEN → re-apply → fullscreen scripture (objects, no band)
  setChurchLayout("fullscreen");
  const out = applyChurchLayout(raw, CHURCH) as any;
  assert.equal(out.scriptureLayout, undefined, "re-applied fullscreen — no band (reversed)");
  assert.ok(out.objects && out.objects.length > 0, "fullscreen scripture rebuilt with styled objects");
});

test("REVERSE the other way: a styled FULLSCREEN verse → reduce → re-apply lowerThird → banded", () => {
  const liveFull = { kind: "text", text: "For God so loved", reference: "John 3:16", objects: [{ kind: "text", x: 0, y: 0, w: 100, h: 100, text: "For God so loved" }] } as any;
  const raw = sourceForRelayout(liveFull) as any;
  assert.equal(raw.objects, undefined, "objects stripped for scripture (re-derived from design)");
  setChurchLayout("lowerThird");
  const out = applyChurchLayout(raw, CHURCH) as any;
  assert.equal(out.scriptureLayout, "lowerThird", "re-applied as a band");
});

test("sourceForRelayout keeps a designed SONG's objects (design survives a full-screen toggle)", () => {
  const designedSong = { kind: "text", text: "chorus", objects: [{ kind: "text", x: 0, y: 0, w: 100, h: 100, text: "chorus" }] } as any;
  const raw = sourceForRelayout(designedSong) as any;
  assert.equal(raw, designedSong, "no reference + no band → returned unchanged (design preserved)");
});

test("sourceForRelayout strips a media third layout so it can re-derive", () => {
  const bandedImg = { kind: "image", url: "https://x/y.png", fit: "cover", layout: "third", band: { topPct: 68, heightPct: 30 }, bandMode: "fit" } as any;
  const raw = sourceForRelayout(bandedImg) as any;
  assert.equal(raw.layout, undefined);
  assert.equal(raw.band, undefined);
  assert.equal(raw.url, "https://x/y.png");
  assert.equal(raw.fit, "cover");
});
