// Media (image/video) third-band: church default auto-applies, identity stays
// stable for unbanded media, and the wire validator accepts/rejects correctly.
// Run: npx tsx --env-file=.env.local test/media-layout.test.ts
import test from "node:test";
import assert from "node:assert/strict";

const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  },
  dispatchEvent: () => true,
};

import { applyChurchLayout, saveScriptureStyle, DEFAULT_SCRIPTURE_DESIGN } from "../src/components/operator/scripture/scriptureStyle";
import { slideOutputIdentity, isValidLiveMessage } from "../src/lib/broadcast";

const CHURCH = "c1";
const IMG = "https://cdn.example.com/pic.jpg";
const setLayout = (layout: "fullscreen" | "lowerThird") => saveScriptureStyle(CHURCH, { ...DEFAULT_SCRIPTURE_DESIGN, layout });
const validSlide = (slide: unknown) => isValidLiveMessage({ type: "set", slide });

test("church default fullscreen → image UNCHANGED (no band)", () => {
  setLayout("fullscreen");
  const img = { kind: "image", url: IMG, fit: "contain" } as any;
  const out = applyChurchLayout(img, CHURCH) as any;
  assert.equal(out.layout, undefined);
  assert.equal(out, img);
});

test("church default lowerThird → image auto-bands into the third (fit)", () => {
  setLayout("lowerThird");
  const img = { kind: "image", url: IMG, fit: "contain" } as any;
  const out = applyChurchLayout(img, CHURCH) as any;
  assert.equal(out.layout, "third");
  assert.equal(out.bandMode, "fit");
  assert.ok(out.band, "band geometry attached");
});

test("church default lowerThird → video auto-bands too", () => {
  setLayout("lowerThird");
  const vid = { kind: "video", url: IMG } as any;
  const out = applyChurchLayout(vid, CHURCH) as any;
  assert.equal(out.layout, "third");
  assert.equal(out.bandMode, "fit");
});

test("per-slide media layout (e.g. a caption) wins over church default", () => {
  setLayout("lowerThird");
  const img = { kind: "image", url: IMG, layout: "third", bandMode: "caption", caption: "Welcome" } as any;
  const out = applyChurchLayout(img, CHURCH) as any;
  assert.equal(out, img, "explicit per-slide layout untouched");
  assert.equal(out.bandMode, "caption");
});

test("identity: UNBANDED image is byte-identical to the pre-feature identity", () => {
  const img = { kind: "image", url: IMG, fit: "contain" } as any;
  assert.equal(slideOutputIdentity(img), `i:${IMG}|contain|`);
});

test("identity: banded image differs from unbanded (re-projects), stable across calls", () => {
  const plain = { kind: "image", url: IMG, fit: "contain" } as any;
  const banded = { kind: "image", url: IMG, fit: "contain", layout: "third", bandMode: "fit", band: { topPct: 68, heightPct: 30 } } as any;
  assert.notEqual(slideOutputIdentity(plain), slideOutputIdentity(banded));
  assert.equal(slideOutputIdentity(banded), slideOutputIdentity({ ...banded }), "deterministic");
});

test("wire validation: a third-band image is valid", () => {
  assert.equal(validSlide({ kind: "image", url: IMG, layout: "third", bandMode: "fit", band: { topPct: 68, heightPct: 30, opacity: 0.7, color: "#000000" } }), true);
});

test("wire validation: bad band / bad bandMode / oversized caption are rejected", () => {
  assert.equal(validSlide({ kind: "image", url: IMG, layout: "third", band: { heightPct: 999 } }), false, "out-of-range band");
  assert.equal(validSlide({ kind: "image", url: IMG, layout: "sideways" }), false, "bad layout enum");
  assert.equal(validSlide({ kind: "image", url: IMG, bandMode: "wobble" }), false, "bad bandMode");
  assert.equal(validSlide({ kind: "image", url: IMG, caption: "x".repeat(501) }), false, "oversized caption");
});

test("wire validation: a plain image with no band still valid", () => {
  assert.equal(validSlide({ kind: "image", url: IMG, fit: "cover" }), true);
});

test("wire validation: band heightPct is capped (blocks a full-screen blackout)", () => {
  assert.equal(validSlide({ kind: "image", url: IMG, layout: "third", band: { heightPct: 48, topPct: 50 } }), true, "48 (editor max) ok");
  assert.equal(validSlide({ kind: "image", url: IMG, layout: "third", band: { heightPct: 61 } }), false, "over-cap rejected");
  assert.equal(validSlide({ kind: "image", url: IMG, layout: "third", band: { heightPct: 100 } }), false, "full-screen rejected");
});
