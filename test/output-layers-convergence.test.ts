/**
 * output-layers-convergence — Phase 3 Layers Panel STRESS / convergence tests
 * (SIX-AGENT gate, Agent 3 stress tester).
 *
 * These model the ACTUAL projector-side + operator-side map machinery (copied
 * verbatim in shape from src/app/live/page.tsx, stage/livestream/ndi, and
 * src/components/operator/useLiveLayers.ts) and assert the convergence contract
 * under patch storms, heartbeat-vs-patch races, and rapid multi-layer sequences.
 *
 * Run: npx tsx test/output-layers-convergence.test.ts
 */
import assert from "node:assert/strict";
import { MAX_LAYERS, projectableTextSlide, type BackgroundSpec, type LayerWire, type SlidePayload, type VideoInputState } from "../src/lib/broadcast";
import { resolveLayeredPlan, resolveLayeredInput, toOverrideMap } from "../src/lib/output-layers-render";
import type { PlanInput } from "../src/lib/output-plan";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}

// ── Model the two map machineries EXACTLY as shipped ────────────────────────

/** Operator hook: last-wins per id (setOverrideMap → new Map + set). */
function operatorApply(map: Map<string, LayerWire>, patch: LayerWire): Map<string, LayerWire> {
  const next = new Map(map);
  next.set(patch.id, patch);
  return next;
}
/** Operator folds overrides into OutputState.layers = Array.from(map.values()). */
function operatorSnapshot(map: Map<string, LayerWire>): LayerWire[] {
  return Array.from(map.values());
}

/** Projector layer-patch handler (live/stage/livestream/ndi are identical):
 *  existing ids always update; a NEW id dropped once map is full. */
function projectorPatch(map: Map<string, LayerWire>, patch: LayerWire): void {
  if (map.has(patch.id) || map.size < MAX_LAYERS) map.set(patch.id, patch);
}
/** Projector heartbeat handler: clear + rebuild from the snapshot's layers. */
function projectorHeartbeat(map: Map<string, LayerWire>, layers: LayerWire[]): void {
  map.clear();
  for (const l of layers) if (map.has(l.id) || map.size < MAX_LAYERS) map.set(l.id, l);
}

/** Normalise a map to a comparable id→enabled/payload snapshot. */
function stackShape(map: Map<string, LayerWire>): Record<string, { enabled: boolean; payloadKey: string }> {
  const out: Record<string, { enabled: boolean; payloadKey: string }> = {};
  for (const [id, l] of map) {
    out[id] = { enabled: l.enabled, payloadKey: JSON.stringify((l as { payload?: unknown }).payload ?? null) };
  }
  return out;
}

const bgA: BackgroundSpec = { type: "shader", shaderPreset: "cleanSlate" } as BackgroundSpec;
const bgB: BackgroundSpec = { type: "image", imageUrl: "https://x/y.jpg" } as BackgroundSpec;
const cam: VideoInputState = { deviceId: "cam-1", label: "Cam" } as VideoInputState;
const textSlide: SlidePayload = projectableTextSlide("John 3:16");

// ── (1) PATCH STORM: operator + projector converge to the same stack ─────────
check("storm: 400 interleaved toggle/swap patches → operator map and projector map converge", () => {
  const ids = ["background", "camera", "slide", "logo"];
  let opMap = new Map<string, LayerWire>();
  const projMap = new Map<string, LayerWire>();
  // Deterministic pseudo-random interleave.
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 400; i++) {
    const id = ids[Math.floor(rnd() * ids.length)];
    const enabled = rnd() > 0.5;
    const patch = { id, kind: id === "background" ? "background" : id === "camera" ? "camera" : id === "logo" ? "logo" : "slide", z: 0, enabled, payload: id === "background" ? (rnd() > 0.5 ? bgA : bgB) : undefined } as LayerWire;
    opMap = operatorApply(opMap, patch);
    projectorPatch(projMap, patch); // same-machine ordered delivery
  }
  assert.deepEqual(stackShape(projMap), stackShape(opMap), "projector diverged from operator after storm");
  assert.ok(opMap.size <= ids.length, `operator map unbounded: ${opMap.size}`);
  assert.ok(projMap.size <= MAX_LAYERS, `projector map exceeded MAX_LAYERS: ${projMap.size}`);
});

// Operator map is bounded by DISTINCT layer ids regardless of storm length.
check("storm: operator override map is bounded by distinct ids (never grows with patch count)", () => {
  let opMap = new Map<string, LayerWire>();
  for (let i = 0; i < 5000; i++) opMap = operatorApply(opMap, { id: "slide", kind: "slide", z: 10, enabled: i % 2 === 0 } as LayerWire);
  assert.equal(opMap.size, 1, "same-id patches must not grow the map");
});

// A hostile same-channel sender cannot grow the projector map past MAX_LAYERS.
check("storm: hostile flood of NEW ids is bounded at MAX_LAYERS on the projector", () => {
  const projMap = new Map<string, LayerWire>();
  for (let i = 0; i < 1000; i++) projectorPatch(projMap, { id: `ghost-${i}`, kind: "message", z: 30, enabled: true } as LayerWire);
  assert.equal(projMap.size, MAX_LAYERS, "projector map must cap at MAX_LAYERS");
});

// ── (2) HEARTBEAT vs PATCH RACE ──────────────────────────────────────────────
// Contract: the LATEST snapshot is authoritative (clear+rebuild). A patch is
// always folded into the operator's subsequent snapshot, so ordered delivery
// converges. A STALE snapshot (pre-patch layers) transiently regresses the patch
// until the next snapshot — this documents the actual (eventually-consistent)
// contract.
check("race: patch then NEWER snapshot carrying it → projector holds the patch (no regress)", () => {
  const projMap = new Map<string, LayerWire>();
  const patch = { id: "slide", kind: "slide", z: 10, enabled: false } as LayerWire; // operator hides slide
  projectorPatch(projMap, patch);
  assert.equal(projMap.get("slide")!.enabled, false, "patch applied");
  // Operator's next heartbeat folds the patch in.
  const opMap = operatorApply(new Map(), patch);
  projectorHeartbeat(projMap, operatorSnapshot(opMap));
  assert.equal(projMap.get("slide")!.enabled, false, "newer snapshot keeps the patch");
});

check("race: STALE pre-patch snapshot transiently regresses, then next snapshot re-converges (documented flap)", () => {
  const projMap = new Map<string, LayerWire>();
  const patch = { id: "slide", kind: "slide", z: 10, enabled: false } as LayerWire;
  // 1. patch arrives.
  projectorPatch(projMap, patch);
  // 2. a STALE snapshot generated BEFORE the operator registered the patch
  //    (layers empty) arrives out-of-order (only possible on the reordering
  //    cross-device Realtime path; same-machine BroadcastChannel is ordered).
  projectorHeartbeat(projMap, []);
  assert.equal(projMap.has("slide"), false, "stale snapshot regressed the patch (flap window)");
  // 3. the authoritative newer snapshot (with the patch) re-converges.
  projectorHeartbeat(projMap, operatorSnapshot(operatorApply(new Map(), patch)));
  assert.equal(projMap.get("slide")!.enabled, false, "re-converged to the patch");
});

// ── (3) OPERATOR REFRESH mid-service ─────────────────────────────────────────
// Operator override map is React memory-only (useState). A refresh drops it →
// overrides=[] → OutputState.layers omitted → projector heartbeat clears its map.
// Both sides converge to NO overrides (consistent), but the operator's manual
// layer edits are LOST (a hidden layer returns, a swapped bg reverts to base).
check("refresh: operator override loss converges both sides to the derived base (no desync, override lost)", () => {
  // operator had hidden the logo + swapped bg
  let opMap = new Map<string, LayerWire>();
  opMap = operatorApply(opMap, { id: "logo", kind: "logo", z: 20, enabled: false } as LayerWire);
  opMap = operatorApply(opMap, { id: "background", kind: "background", z: 0, enabled: true, payload: bgB } as LayerWire);
  const projMap = new Map<string, LayerWire>();
  projectorHeartbeat(projMap, operatorSnapshot(opMap));
  assert.equal(projMap.get("logo")!.enabled, false, "pre-refresh: logo hidden on projector");
  // --- operator refreshes: memory map gone, overrides=[] ---
  const afterRefresh = new Map<string, LayerWire>();
  projectorHeartbeat(projMap, operatorSnapshot(afterRefresh)); // layers omitted → []
  assert.equal(projMap.size, 0, "projector converges to no overrides after operator refresh");
  // No DESYNC (both empty), but the override is gone — render falls back to base.
});

// ── (5) RAPID camera + slide-clear + background-swap: plan stays consistent ───
check("rapid: camera live + slide cleared + bg swapped resolves to a consistent, non-crashing plan", () => {
  const base: PlanInput = { mode: "live", slide: textSlide, videoInput: cam, background: bgA };
  const overrides: LayerWire[] = [
    { id: "camera", kind: "camera", z: 5, enabled: true, payload: cam },
    { id: "slide", kind: "slide", z: 10, enabled: false },       // clear slide
    { id: "background", kind: "background", z: 0, enabled: true, payload: bgB }, // swap bg
  ];
  const resolved = resolveLayeredInput(base, overrides);
  assert.equal(resolved.slide.kind, "empty", "slide cleared");
  assert.equal(resolved.videoInput, cam, "camera still live");
  const plan = resolveLayeredPlan(base, overrides);
  // Camera live ⇒ slide renders over-video (camera shows through); NOT black.
  const slideLayer = plan.layers.find((l) => l.id === "slide") as { enabled: boolean; props: { renderMode: string } };
  assert.equal(slideLayer.props.renderMode, "over-video", "camera-behind render preserved with empty slide");
  // camera-wins: background template suppressed while camera live (bg swap stored but not shown).
  assert.equal(plan.layers.find((l) => l.id === "background")!.enabled, false, "camera-wins suppresses bg template");
});

check("rapid: camera THEN cleared with slide already cleared → legitimate black (empty), consistent", () => {
  const base: PlanInput = { mode: "live", slide: textSlide, videoInput: cam, background: bgA };
  const resolved = resolveLayeredInput(base, [
    { id: "slide", kind: "slide", z: 10, enabled: false },
    { id: "camera", kind: "camera", z: 5, enabled: false },
    { id: "background", kind: "background", z: 0, enabled: false },
  ]);
  assert.equal(resolved.slide.kind, "empty");
  assert.equal(resolved.videoInput, null);
  assert.equal(resolved.background, null);
  const plan = resolveLayeredPlan(base, [
    { id: "slide", kind: "slide", z: 10, enabled: false },
    { id: "camera", kind: "camera", z: 5, enabled: false },
    { id: "background", kind: "background", z: 0, enabled: false },
  ]);
  // Nothing enabled to paint content — this is an intentional full clear, not a bug.
  const slideLayer = plan.layers.find((l) => l.id === "slide") as { props: { renderMode: string } };
  assert.notEqual(slideLayer.props.renderMode, "over-video", "no camera ⇒ not over-video");
});

// ── (6) TWO OPERATORS same church → heartbeat clobber (documented) ───────────
// Each operator's OutputState heartbeat carries ONLY its own overrides, and the
// projector REBUILDS (clear) from the snapshot — so two heartbeating operators
// alternately clobber each other's layer stack (worse than clean last-write-wins).
check("duel: two operators' heartbeats each clobber the other's overrides (documents 🟡)", () => {
  const projMap = new Map<string, LayerWire>();
  const opA = operatorApply(new Map(), { id: "background", kind: "background", z: 0, enabled: true, payload: bgA } as LayerWire);
  const opB = operatorApply(new Map(), { id: "logo", kind: "logo", z: 20, enabled: false } as LayerWire);
  projectorHeartbeat(projMap, operatorSnapshot(opA));
  assert.equal(projMap.has("background"), true, "A's bg applied");
  assert.equal(projMap.has("logo"), false, "B's logo NOT present (A snapshot is whole-state authoritative)");
  projectorHeartbeat(projMap, operatorSnapshot(opB));
  assert.equal(projMap.has("logo"), true, "B's logo applied");
  assert.equal(projMap.has("background"), false, "A's bg CLOBBERED by B's heartbeat — flap between operators");
});

// ── (7) ZONE toggle on a MEDIA slide is a silent no-op on the projector ──────
check("zone: lowerThird on an image/video slide does nothing (silent no-op — misleading affordance 🟡)", () => {
  const imageSlide = { kind: "image", url: "https://x/pic.jpg" } as unknown as SlidePayload;
  const base: PlanInput = { mode: "live", slide: imageSlide };
  const resolved = resolveLayeredInput(base, [{ id: "slide", kind: "slide", z: 10, enabled: true, zone: { kind: "lowerThird" } }]);
  // resolveLayeredInput only applies zone when slide.kind === "text".
  assert.equal((resolved.slide as { scriptureLayout?: string }).scriptureLayout, undefined, "zone ignored for non-text slide");
  assert.deepEqual(resolved.slide, imageSlide, "media slide untouched by zone toggle");
});

// ── dup-id array semantics: toOverrideMap first-wins vs projector last-wins ───
check("dup-id: toOverrideMap is FIRST-wins while projector heartbeat is LAST-wins (adversarial mismatch 🟡)", () => {
  const first = { id: "slide", kind: "slide", z: 10, enabled: true } as LayerWire;
  const second = { id: "slide", kind: "slide", z: 10, enabled: false } as LayerWire;
  const rendered = toOverrideMap([first, second]);
  assert.equal(rendered.get("slide")!.enabled, true, "render resolver takes FIRST dup");
  const projMap = new Map<string, LayerWire>();
  projectorHeartbeat(projMap, [first, second]);
  assert.equal(projMap.get("slide")!.enabled, false, "projector heartbeat takes LAST dup");
  // Non-issue in practice: OutputState.layers is Array.from(Map.values()) → unique ids.
});

// ── (R1) SLIDE ZONE / RE-ARM across slide sends ──────────────────────────────
// Model the operator's rearmSlide() decision (useLiveLayers): on a real new
// slide send, a stale enabled=false slide override is dropped/re-enabled while a
// non-"full" zone PERSISTS. Slide zone/visibility overrides carry NO payload
// (R1a) — resolveLayeredInput must render the CURRENT base slide in the zone.
function rearmSlide(map: Map<string, LayerWire>): Map<string, LayerWire> {
  const o = map.get("slide");
  if (!o || o.enabled) return map; // nothing to re-arm
  const zone = o.zone;
  const sticky = zone && zone.kind !== "full";
  const next = new Map(map);
  if (sticky) next.set("slide", { id: "slide", kind: "slide", z: 10, enabled: true, zone });
  else next.delete("slide");
  return next;
}

check("R1a: zone-toggle to lowerThird carries NO payload, renders the CURRENT slide in the band", () => {
  // Operator toggles zone on the live slide → payload-less override (R1a).
  const zonePatch: LayerWire = { id: "slide", kind: "slide", z: 10, enabled: true, zone: { kind: "lowerThird" } };
  assert.equal((zonePatch as { payload?: unknown }).payload, undefined, "zone patch must not snapshot payload");
  // Slide advances to a NEW verse; the base slide changes, override unchanged.
  const newSlide = projectableTextSlide("Psalm 23:1");
  const base: PlanInput = { mode: "live", slide: newSlide };
  const resolved = resolveLayeredInput(base, [zonePatch]);
  assert.equal((resolved.slide as { scriptureLayout?: string }).scriptureLayout, "lowerThird", "new slide rendered in the band");
  assert.equal((resolved.slide as { text?: string }).text, (newSlide as { text?: string }).text, "band shows the CURRENT slide text, not a stale snapshot");
});

check("R1b: slide CLEAR then a new slide SEND → new slide visible (override re-armed)", () => {
  const first = projectableTextSlide("John 3:16");
  // Operator clears the slide layer (enabled=false, no payload for slide/R1a).
  let map = operatorApply(new Map(), { id: "slide", kind: "slide", z: 10, enabled: false });
  const clearedBase: PlanInput = { mode: "live", slide: first };
  assert.equal(resolveLayeredInput(clearedBase, operatorSnapshot(map)).slide.kind, "empty", "slide cleared → blank");
  // A NEW slide is sent live → rearmSlide drops the stale disabled override.
  map = rearmSlide(map);
  const newSlide = projectableTextSlide("Psalm 23:1");
  const base: PlanInput = { mode: "live", slide: newSlide };
  const resolved = resolveLayeredInput(base, operatorSnapshot(map));
  assert.equal((resolved.slide as { text?: string }).text, (newSlide as { text?: string }).text, "new slide is visible after re-arm");
  assert.equal(map.has("slide"), false, "full-zone stale override dropped on re-arm");
});

check("R1b: lowerThird ZONE PERSISTS across slide sends (sticky zone survives re-arm)", () => {
  // Zone set to lowerThird (enabled), then a new slide is sent.
  let map = operatorApply(new Map(), { id: "slide", kind: "slide", z: 10, enabled: true, zone: { kind: "lowerThird" } });
  map = rearmSlide(map); // enabled already true → no-op, zone persists
  assert.equal(map.get("slide")!.zone!.kind, "lowerThird", "zone persists across a send");
  const newSlide = projectableTextSlide("Romans 8:28");
  const resolved = resolveLayeredInput({ mode: "live", slide: newSlide }, operatorSnapshot(map));
  assert.equal((resolved.slide as { scriptureLayout?: string }).scriptureLayout, "lowerThird", "new slide still in the band");
  // Now the operator had HIDDEN the slide but kept the band → re-arm re-enables
  // AND preserves the band.
  let hidden = operatorApply(new Map(), { id: "slide", kind: "slide", z: 10, enabled: false, zone: { kind: "lowerThird" } });
  hidden = rearmSlide(hidden);
  assert.equal(hidden.get("slide")!.enabled, true, "hidden slide re-enabled on send");
  assert.equal(hidden.get("slide")!.zone!.kind, "lowerThird", "band preserved through re-arm");
});

console.log(`\noutput-layers-convergence: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
