/**
 * LayerWire wire-contract validation tests (Decoupling Phase 2).
 *
 * The layer model is ADDITIVE + DORMANT, but it rides the same untrusted
 * BroadcastChannel / Realtime / LAN wire as everything else, so it is hardened
 * to the same posture: unknown/invalid layers are DROPPED, never passed through.
 * These tests pin that hardening against malicious payloads (javascript: URLs,
 * huge arrays, NaN z, id injection, prototype pollution) plus the layer-patch
 * message shape and the sanitizeOutputState fail-open salvage.
 *
 * Run: npx tsx test/layer-wire.test.ts
 */
import assert from "node:assert/strict";
import {
  isValidLayerWire,
  isValidLiveMessage,
  isValidOutputStateExternal,
  sanitizeOutputState,
  coerceLiveMessage,
  scrubOutputStateForRemote,
  EMPTY_OUTPUT,
  MAX_LAYERS,
  type LayerWire,
  type OutputState,
  type SlidePayload,
} from "../src/lib/broadcast";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}

console.log("LayerWire validation");

// ---- valid layers, one per kind --------------------------------------------
const validLayers: LayerWire[] = [
  { id: "background", kind: "background", z: 0, enabled: true, payload: { type: "shader", shaderPreset: "gentle-waves" } },
  { id: "background-off", kind: "background", z: 0, enabled: false, payload: null },
  { id: "camera", kind: "camera", z: 5, enabled: true, transportScope: "local", payload: { deviceId: "cam-1", overlay: "full" } },
  { id: "slide", kind: "slide", z: 10, enabled: true, zone: { kind: "full" }, payload: { kind: "text", text: "In the beginning" } },
  { id: "media", kind: "media", z: 10, enabled: true, payload: { kind: "image", url: "https://x/i.jpg" } },
  { id: "band-1", kind: "band", z: 15, enabled: true, zone: { kind: "band", yPct: 66, hPct: 33 }, payload: { color: "#000000", opacity: 0.8 } },
  { id: "announce", kind: "announcement", z: 20, enabled: true, payload: { line1: "Welcome", position: "lower_third", style: { fontFamily: "Inter", fontSizePx: 40, fontWeight: 700, textColor: "#fff", bgColor: "#000", bgOpacity: 80, padding: 12, borderRadius: 8, align: "center" } } },
  { id: "timer", kind: "timer", z: 20, enabled: true, payload: { remainingSec: 300, running: true, kind: "countdown" } },
  { id: "msg", kind: "message", z: 20, enabled: true, opacity: 0.5, payload: { text: "Prayer now", position: "lower-third" } },
  { id: "toggle-only", kind: "slide", z: 10, enabled: false }, // payload-less patch (enable/z only)
  { id: "logo", kind: "logo", z: 20, enabled: true }, // theme logo, no payload
  { id: "logo-url", kind: "logo", z: 20, enabled: true, payload: { url: "https://x/logo.png" } }, // explicit-logo url
  { id: "slide-tr", kind: "slide", z: 10, enabled: true, bgTransparent: true, payload: { kind: "text", text: "over video" } }, // bgTransparent flag
];

check("every valid layer (one per kind) passes", () => {
  for (const l of validLayers) assert.ok(isValidLayerWire(l), `${l.id} (${l.kind}) should be valid`);
});

// ---- id hardening -----------------------------------------------------------
check("malicious / malformed ids are rejected", () => {
  const base = { kind: "slide", z: 10, enabled: true } as const;
  assert.ok(!isValidLayerWire({ ...base, id: "" }), "empty id");
  assert.ok(!isValidLayerWire({ ...base, id: "a b" }), "space in id");
  assert.ok(!isValidLayerWire({ ...base, id: "<script>alert(1)</script>" }), "markup id");
  assert.ok(!isValidLayerWire({ ...base, id: "a".repeat(65) }), "over-long id");
  assert.ok(!isValidLayerWire({ ...base, id: "url(#x)" }), "css-ish id");
  assert.ok(!isValidLayerWire({ ...base, id: 42 }), "non-string id");
  assert.ok(isValidLayerWire({ ...base, id: "bg_1-A" }), "safe token id passes");
});

// ---- kind hardening ---------------------------------------------------------
check("unknown kind rejected", () => {
  assert.ok(!isValidLayerWire({ id: "x", kind: "iframe", z: 0, enabled: true }));
  assert.ok(!isValidLayerWire({ id: "x", kind: "", z: 0, enabled: true }));
});

// ---- z hardening ------------------------------------------------------------
check("NaN / Infinity / out-of-range z rejected", () => {
  const base = { id: "z", kind: "slide", enabled: true } as const;
  assert.ok(!isValidLayerWire({ ...base, z: NaN }), "NaN z");
  assert.ok(!isValidLayerWire({ ...base, z: Infinity }), "Infinity z");
  assert.ok(!isValidLayerWire({ ...base, z: 1e9 }), "huge z");
  assert.ok(!isValidLayerWire({ ...base, z: -5000 }), "very negative z");
  assert.ok(!isValidLayerWire({ ...base, z: "10" }), "string z");
  assert.ok(isValidLayerWire({ ...base, z: -1000 }) && isValidLayerWire({ ...base, z: 1000 }), "boundary z ok");
});

// ---- opacity / zone / transportScope hardening -----------------------------
check("opacity, zone percentages and transportScope are bounded", () => {
  const base = { id: "o", kind: "slide", z: 10, enabled: true } as const;
  assert.ok(!isValidLayerWire({ ...base, opacity: 1.5 }), "opacity > 1");
  assert.ok(!isValidLayerWire({ ...base, opacity: -0.1 }), "opacity < 0");
  assert.ok(!isValidLayerWire({ ...base, opacity: NaN }), "opacity NaN");
  assert.ok(!isValidLayerWire({ ...base, zone: { kind: "band", yPct: 120, hPct: 10 } }), "yPct > 100");
  assert.ok(!isValidLayerWire({ ...base, zone: { kind: "band", yPct: 10, hPct: 0 } }), "hPct < 1");
  assert.ok(!isValidLayerWire({ ...base, zone: { kind: "band", yPct: NaN, hPct: 10 } }), "yPct NaN");
  assert.ok(!isValidLayerWire({ ...base, zone: { kind: "wat" } }), "unknown zone kind");
  assert.ok(isValidLayerWire({ ...base, zone: { kind: "band", yPct: 0, hPct: 100 } }), "band boundary ok");
  assert.ok(!isValidLayerWire({ ...base, transportScope: "cloud" }), "bad transportScope");
});

// ---- payload hardening: URLs go through the existing https/blob validators --
check("malicious payload URLs are rejected", () => {
  assert.ok(!isValidLayerWire({ id: "bg", kind: "background", z: 0, enabled: true, payload: { type: "image", imageUrl: "javascript:alert(1)" } }), "js: bg image");
  assert.ok(!isValidLayerWire({ id: "s", kind: "slide", z: 10, enabled: true, payload: { kind: "image", url: "javascript:alert(1)" } }), "js: slide image");
  assert.ok(!isValidLayerWire({ id: "s", kind: "media", z: 10, enabled: true, payload: { kind: "video", url: "file:///etc/passwd" } }), "file: media video");
  assert.ok(!isValidLayerWire({ id: "m", kind: "message", z: 20, enabled: true, payload: { text: "x".repeat(3000) } }), "over-long message text");
  assert.ok(!isValidLayerWire({ id: "t", kind: "timer", z: 20, enabled: true, payload: { remainingSec: 9e9, running: true, kind: "countdown" } }), "runaway timer");
  // A valid https media URL passes.
  assert.ok(isValidLayerWire({ id: "s", kind: "slide", z: 10, enabled: true, payload: { kind: "image", url: "https://x/i.jpg" } }), "https image ok");
});

// ---- prototype pollution ----------------------------------------------------
check("prototype-pollution keys rejected on layer + zone + payload", () => {
  assert.ok(!isValidLayerWire(JSON.parse('{"id":"x","kind":"slide","z":10,"enabled":true,"__proto__":{"x":1}}')));
  assert.ok(!isValidLayerWire({ id: "x", kind: "slide", z: 10, enabled: true, zone: JSON.parse('{"kind":"full","constructor":1}') }));
});

// ---- layer-patch LiveMessage ------------------------------------------------
check("layer-patch message validates its layer", () => {
  assert.ok(isValidLiveMessage({ type: "layer-patch", layer: validLayers[0] }), "valid layer-patch");
  assert.ok(!isValidLiveMessage({ type: "layer-patch", layer: { id: "x", kind: "iframe", z: 0, enabled: true } }), "bad layer rejected");
  assert.ok(!isValidLiveMessage({ type: "layer-patch" }), "missing layer");
});

check("coerceLiveMessage passes a valid layer-patch, drops an invalid one", () => {
  const ok = coerceLiveMessage({ type: "layer-patch", layer: validLayers[3] });
  assert.ok(ok && ok.type === "layer-patch", "valid passes through");
  assert.equal(coerceLiveMessage({ type: "layer-patch", layer: { id: "b a d" } }), null, "invalid → null (not salvaged)");
});

// ---- OutputState.layers -----------------------------------------------------
check("OutputState with a valid layers array passes the strict validator", () => {
  const st: OutputState = { ...EMPTY_OUTPUT, layers: validLayers };
  assert.ok(isValidOutputStateExternal(st), "valid layers accepted");
});

check("strict validator rejects an over-long or malformed layers array", () => {
  const tooMany = Array.from({ length: MAX_LAYERS + 1 }, (_, i) => ({ id: `l${i}`, kind: "slide", z: 10, enabled: true }));
  assert.ok(!isValidOutputStateExternal({ ...EMPTY_OUTPUT, layers: tooMany }), "over-cap array rejected");
  assert.ok(!isValidOutputStateExternal({ ...EMPTY_OUTPUT, layers: [{ id: "x", kind: "iframe", z: 0, enabled: true }] }), "bad entry rejected");
  assert.ok(!isValidOutputStateExternal({ ...EMPTY_OUTPUT, layers: "nope" as unknown as LayerWire[] }), "non-array rejected");
});

check("sanitizeOutputState DROPS invalid layers, caps length, keeps the good ones", () => {
  const mixed = [
    validLayers[0],                                       // keep
    { id: "b a d", kind: "slide", z: 10, enabled: true }, // drop (bad id)
    { id: "js", kind: "background", z: 0, enabled: true, payload: { type: "image", imageUrl: "javascript:x" } }, // drop (bad url)
    validLayers[3],                                       // keep
  ];
  const st = sanitizeOutputState({ ...EMPTY_OUTPUT, layers: mixed });
  assert.ok(st, "state salvaged");
  assert.equal(st!.layers?.length, 2, "only the two valid layers survive");
  assert.deepEqual(st!.layers?.map((l) => l.id), ["background", "slide"]);
  assert.ok(isValidOutputStateExternal(st), "salvaged state passes strict validation");
});

check("sanitizeOutputState caps a huge layers array at MAX_LAYERS", () => {
  const huge = Array.from({ length: 500 }, (_, i) => ({ id: `l${i}`, kind: "slide" as const, z: 10, enabled: true }));
  const st = sanitizeOutputState({ ...EMPTY_OUTPUT, layers: huge });
  assert.ok(st && (st.layers?.length ?? 0) <= MAX_LAYERS, `capped at ${MAX_LAYERS}`);
});

check("sanitizeOutputState leaves layers undefined when absent (never fabricates [])", () => {
  const st = sanitizeOutputState({ ...EMPTY_OUTPUT });
  assert.ok(st, "state ok");
  assert.equal("layers" in st!, false, "no layers key fabricated");
});

// ---- logo payload + bgTransparent hardening --------------------------------
check("logo payload url goes through the render-url gate; bgTransparent is boolean", () => {
  assert.ok(isValidLayerWire({ id: "logo", kind: "logo", z: 20, enabled: true }), "no-payload logo ok");
  assert.ok(isValidLayerWire({ id: "logo", kind: "logo", z: 20, enabled: true, payload: null }), "null-payload logo ok");
  assert.ok(!isValidLayerWire({ id: "logo", kind: "logo", z: 20, enabled: true, payload: { url: "javascript:alert(1)" } }), "js: logo url rejected");
  assert.ok(isValidLayerWire({ id: "logo", kind: "logo", z: 20, enabled: true, payload: { url: "https://x/l.png" } }), "https logo url ok");
  assert.ok(!isValidLayerWire({ id: "s", kind: "slide", z: 10, enabled: true, bgTransparent: "yes" as unknown as boolean }), "non-boolean bgTransparent rejected");
  assert.ok(isValidLayerWire({ id: "s", kind: "slide", z: 10, enabled: true, bgTransparent: true }), "boolean bgTransparent ok");
});

// ---- duplicate-id policy ----------------------------------------------------
check("sanitizeLayers drops subsequent duplicate ids (first wins)", () => {
  const dupes = [
    { id: "bg", kind: "background", z: 0, enabled: true, payload: { type: "shader", shaderPreset: "a" } },
    { id: "bg", kind: "background", z: 0, enabled: false, payload: { type: "shader", shaderPreset: "b" } }, // dup id → dropped
    { id: "slide", kind: "slide", z: 10, enabled: true, payload: { kind: "text", text: "x" } },
  ];
  const st = sanitizeOutputState({ ...EMPTY_OUTPUT, layers: dupes });
  assert.ok(st, "salvaged");
  assert.equal(st!.layers?.length, 2, "dup dropped, two survive");
  assert.deepEqual(st!.layers?.map((l) => l.id), ["bg", "slide"]);
  // First wins: the SURVIVING bg is the first (enabled:true), not the shadow.
  assert.equal(st!.layers?.find((l) => l.id === "bg")?.enabled, true, "first-wins on the duplicate id");
});

check("strict validator REJECTS a layers array with duplicate ids", () => {
  const dupes = [
    { id: "x", kind: "slide", z: 10, enabled: true },
    { id: "x", kind: "slide", z: 11, enabled: true },
  ];
  assert.ok(!isValidOutputStateExternal({ ...EMPTY_OUTPUT, layers: dupes }), "duplicate ids rejected by strict validator");
});

// ---- forward-compat: an unknown FUTURE kind is non-fatal -------------------
// A newer sender may add a kind an older receiver doesn't know (e.g. "audio",
// reserved for Phase 5). The contract: it must be DROPPED by the fail-open
// sanitizer (never crash / poison the snapshot) and REJECTED by the strict
// array validator (a strict sender must not ship shapes we can't render).
check("unknown future kind ('audio') is dropped by sanitizeLayers, rejected by strict validator", () => {
  const future = [
    { id: "aud", kind: "audio", z: 5, enabled: true, payload: { deviceId: "spk-1" } }, // unknown kind
    { id: "slide", kind: "slide", z: 10, enabled: true, payload: { kind: "text", text: "keep" } },
  ];
  assert.ok(!isValidLayerWire(future[0]), "unknown kind is not a valid layer");
  assert.ok(!isValidOutputStateExternal({ ...EMPTY_OUTPUT, layers: future }), "strict validator rejects the array");
  const st = sanitizeOutputState({ ...EMPTY_OUTPUT, layers: future });
  assert.ok(st, "sanitize is fail-open (state survives)");
  assert.equal(st!.layers?.length, 1, "the unknown-kind layer is dropped, the good slide kept");
  assert.equal(st!.layers?.[0].id, "slide");
});

// ---- /ndi salvage: one bad neighbour field, good parts still render ---------
// The /ndi handler reads state.live, fontScale, appearance, background,
// videoInput, transition off a coerced "output" message. A single bad neighbour
// field (here: a garbage appearance) must be salvaged field-by-field so the NDI
// surface still gets the live slide + the good fields (was: whole snapshot
// rejected). Mirrors /live + /livestream fail-open recovery.
check("coerceLiveMessage salvages an output with one bad field for the ndi handler", () => {
  const goodSlide: SlidePayload = { kind: "text", text: "In the beginning" };
  const raw = {
    type: "output",
    state: {
      ...EMPTY_OUTPUT,
      live: goodSlide,
      fontScale: 1.5,
      background: { type: "shader", shaderPreset: "gentle-waves" },
      appearance: { bgType: "wat", nonsense: true }, // BAD neighbour field
      transition: { kind: "fade", durationMs: 300 },
    },
  };
  const msg = coerceLiveMessage(raw);
  assert.ok(msg && msg.type === "output", "salvaged as output (not dropped)");
  const s = (msg as { state: OutputState }).state;
  // Exactly what the ndi handler reads:
  assert.equal(s.live.kind === "text" && s.live.text, "In the beginning", "live slide intact");
  assert.equal(s.fontScale, 1.5, "good fontScale kept");
  assert.ok(s.background && s.background.type === "shader", "good background kept");
  assert.equal(s.appearance, null, "bad appearance salvaged to null (not fatal)");
});

// ---- scrubOutputStateForRemote: preserves the legacy videoInput scrub -------
// This helper replaced the inline `state.videoInput ? {...state, videoInput:null}
// : state` at the Realtime/LAN fan-out. It MUST preserve that behaviour exactly,
// and additionally drop transportScope:"local" layers for remote transports
// (inert today — layers is never populated).
check("scrub returns the SAME reference when there is nothing to strip (no videoInput, no local layers)", () => {
  const st = { ...EMPTY_OUTPUT } as OutputState;
  assert.equal(scrubOutputStateForRemote(st), st, "identity when nothing to strip (matches old `: state` branch)");
  const withAllLayers = { ...EMPTY_OUTPUT, layers: [validLayers[0]] } as OutputState; // scope "all"
  assert.equal(scrubOutputStateForRemote(withAllLayers), withAllLayers, "all-scope layers left untouched (same ref)");
});

check("scrub nulls videoInput (exactly the legacy behaviour)", () => {
  const st = { ...EMPTY_OUTPUT, videoInput: { deviceId: "cam-1", overlay: "full" } } as unknown as OutputState;
  const out = scrubOutputStateForRemote(st);
  assert.notEqual(out, st, "new object when videoInput present");
  assert.equal(out.videoInput, null, "videoInput nulled");
  // Every OTHER field is preserved (spread), matching the old {...state, videoInput:null}.
  assert.equal(out.live, st.live);
  assert.equal(out.aspectRatio, st.aspectRatio);
});

check("scrub drops transportScope:'local' layers for remote, keeps 'all' layers", () => {
  const localCam = validLayers.find((l) => l.transportScope === "local")!; // camera
  const st = { ...EMPTY_OUTPUT, layers: [validLayers[0], localCam, validLayers[3]] } as OutputState;
  const out = scrubOutputStateForRemote(st);
  assert.notEqual(out, st, "new object when a local-scope layer is present");
  assert.ok(out.layers && out.layers.every((l) => l.transportScope !== "local"), "no local layers remain");
  assert.deepEqual(out.layers?.map((l) => l.id), ["background", "slide"], "all-scope layers preserved in order");
});

console.log(`\nLayerWire: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
