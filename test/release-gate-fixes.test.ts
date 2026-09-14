// Release-gate fixes (2026-09-14): layout clamp, media sanitize, layers guard,
// Full zone un-bands media, OBS media caption, direct-send layout idempotence.
// Run: npx tsx test/release-gate-fixes.test.ts
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

import { applyChurchLayout, loadScriptureStyle, bandWireFromDesign, saveScriptureStyle, DEFAULT_SCRIPTURE_DESIGN } from "../src/components/operator/scripture/scriptureStyle";
import { sanitizeOutputState, isValidOutputState, slideOutputIdentity, type SlidePayload } from "../src/lib/broadcast";
import { rebuildOverridesFromSnapshot } from "../src/lib/output-layers";
import { resolveLayeredInput } from "../src/lib/output-layers-render";
import { overlayBandSlide, DEFAULT_OBS_BAND } from "../src/lib/obs-lowerthird";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}
const CH = "church-x";
const state = (live: unknown) => ({ live, aspectRatio: "16:9" });

check("15: corrupted saved band is clamped → every styled slide validates", () => {
  store.set(`pf.scriptureStyle.v2.${CH}`, JSON.stringify({ layout: "lowerThird", band: { heightPct: 500, fontScale: null, opacity: 9, color: "red", offsetY: "x", position: "sideways", mode: "weird" } }));
  const d = loadScriptureStyle(CH);
  assert.ok(d.band.heightPct >= 10 && d.band.heightPct <= 60);
  assert.ok(Number.isFinite(d.band.fontScale));
  assert.ok(d.band.opacity >= 0 && d.band.opacity <= 1);
  assert.match(d.band.color, /^#/);
  for (const s of [
    { kind: "text", text: "Amazing grace" },
    { kind: "text", text: "For God so loved", reference: "John 3:16" },
    { kind: "image", url: "https://a.b/c.png" },
    { kind: "video", url: "https://a.b/c.mp4" },
  ] as SlidePayload[]) {
    const out = applyChurchLayout(s, CH);
    assert.ok(isValidOutputState(state(out)), `invalid after layout: ${JSON.stringify(out).slice(0, 160)}`);
  }
  // NaN survives JSON as null; a direct NaN design (editor draft) is clamped too.
  const w = bandWireFromDesign({ ...DEFAULT_SCRIPTURE_DESIGN, layout: "lowerThird", band: { ...DEFAULT_SCRIPTURE_DESIGN.band, fontScale: NaN, heightPct: 999 } });
  assert.ok(w && Number.isFinite(w.fontScale!) && w.heightPct! <= 60);
});

check("15: valid saved band is unchanged", () => {
  saveScriptureStyle(CH, { ...DEFAULT_SCRIPTURE_DESIGN, layout: "lowerThird", band: { ...DEFAULT_SCRIPTURE_DESIGN.band, heightPct: 40, opacity: 0.5, color: "#112233" } });
  const d = loadScriptureStyle(CH);
  assert.equal(d.band.heightPct, 40); assert.equal(d.band.opacity, 0.5); assert.equal(d.band.color, "#112233");
});

check("16: sanitizeOutputState media with bad band/caption keeps media and validates", () => {
  const a = sanitizeOutputState(state({ kind: "image", url: "https://a.b/c.png", layout: "third", band: { topPct: 500 } }));
  assert.ok(a && isValidOutputState(a));
  assert.equal((a!.live as { url: string }).url, "https://a.b/c.png");
  assert.equal((a!.live as { band?: unknown }).band, undefined);
  const b = sanitizeOutputState(state({ kind: "video", url: "https://a.b/c.mp4", caption: 7, fit: "stretch", volume: 9 }));
  assert.ok(b && isValidOutputState(b));
  assert.equal(b!.live.kind, "video");
  const good = { kind: "image", url: "https://a.b/c.png", fit: "cover", layout: "third", band: { topPct: 60, heightPct: 30 }, bandMode: "caption", caption: "Welcome" };
  const c = sanitizeOutputState(state(good));
  assert.deepEqual(c!.live, good, "a valid banded media slide is preserved exactly");
  // Mini fuzz.
  const junk = [undefined, null, 7, "x", NaN, {}, { topPct: -1 }, { heightPct: 99 }, "third", "caption", "fit", true];
  for (let i = 0; i < 2000; i++) {
    const pick = () => junk[Math.floor(Math.random() * junk.length)];
    const s = sanitizeOutputState(state({ kind: Math.random() < 0.5 ? "image" : "video", url: "https://a.b/c.png", layout: pick(), band: pick(), bandMode: pick(), caption: pick(), fit: pick(), loop: pick(), volume: pick(), blurFill: pick() }));
    assert.ok(s === null || isValidOutputState(s), `fuzz ${i} produced invalid state`);
  }
});

check("17: rebuildOverridesFromSnapshot tolerates non-array layers", () => {
  const m = new Map();
  for (const bad of [42, "x", {}, true, [null], [7, null, { id: 3 }]]) {
    assert.doesNotThrow(() => rebuildOverridesFromSnapshot(m, bad as never));
  }
});

check("13: Layers Full zone un-bands media", () => {
  const banded: SlidePayload = { kind: "image", url: "https://a.b/c.png", fit: "contain", layout: "third", band: { topPct: 60, heightPct: 30 }, bandMode: "fit" };
  const input = { slide: banded } as never;
  const out = resolveLayeredInput(input, [{ id: "slide", kind: "slide", z: 10, enabled: true, zone: { kind: "full" } }] as never) as { slide: SlidePayload };
  assert.deepEqual(out.slide, { kind: "image", url: "https://a.b/c.png", fit: "contain" });
  const lower = resolveLayeredInput(input, [{ id: "slide", kind: "slide", z: 10, enabled: true, zone: { kind: "lowerThird" } }] as never) as { slide: SlidePayload };
  assert.deepEqual(lower.slide, banded, "lowerThird zone leaves media unchanged");
});

check("14: OBS lower_third shows banded media caption, else empty", () => {
  const cap = overlayBandSlide({ kind: "image", url: "https://a.b/c.png", layout: "third", bandMode: "caption", caption: "  Welcome home " }, DEFAULT_OBS_BAND) as { kind: string; text?: string; scriptureLayout?: string };
  assert.equal(cap.kind, "text"); assert.equal(cap.text, "Welcome home"); assert.equal(cap.scriptureLayout, "lowerThird");
  assert.ok(isValidOutputState(state(cap)));
  assert.deepEqual(overlayBandSlide({ kind: "video", url: "https://a.b/c.mp4", layout: "third" }, DEFAULT_OBS_BAND), { kind: "empty" });
  assert.deepEqual(overlayBandSlide({ kind: "image", url: "https://a.b/c.png" }, DEFAULT_OBS_BAND), { kind: "empty" });
});

check("12: applyChurchLayout is idempotent (direct send paths can't double-apply)", () => {
  for (const layout of ["fullscreen", "lowerThird"] as const) {
    saveScriptureStyle(CH, { ...DEFAULT_SCRIPTURE_DESIGN, layout });
    for (const s of [
      { kind: "text", text: "Amazing grace how sweet" },
      { kind: "text", text: "For God so loved", reference: "John 3:16" },
      { kind: "image", url: "https://a.b/c.png" },
      { kind: "blank", bgColor: "#000000" },
      { kind: "empty" },
    ] as SlidePayload[]) {
      const once = applyChurchLayout(s, CH);
      const twice = applyChurchLayout(once, CH);
      assert.equal(slideOutputIdentity(twice), slideOutputIdentity(once), `${layout} ${s.kind}`);
      if (s.kind === "blank" || s.kind === "empty") assert.equal(once, s);
    }
  }
  saveScriptureStyle(CH, { ...DEFAULT_SCRIPTURE_DESIGN, layout: "lowerThird" });
  const banded = applyChurchLayout({ kind: "text", text: "Amazing grace how sweet" }, CH) as { scriptureLayout?: string };
  assert.equal(banded.scriptureLayout, "lowerThird", "direct song send now bands like click/Enter");
});

console.log(`\n${pass} passed, ${fail} failed`);
assert.equal(fail, 0);
