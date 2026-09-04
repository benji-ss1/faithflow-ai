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

import { applyChurchLayout, songLowerThirdPayload, saveScriptureStyle, DEFAULT_SCRIPTURE_DESIGN } from "../src/components/operator/scripture/scriptureStyle";

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
