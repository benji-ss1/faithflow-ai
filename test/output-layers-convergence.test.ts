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
import { applyLayerPatchBounded, rebuildOverridesFromSnapshot, isStaleLayersSnapshot, type EpochRef } from "../src/lib/output-layers";
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
  // Delegate to the REAL shipped fold so these convergence tests exercise the
  // actual code (incl. the rev gate), not a drifting copy.
  applyLayerPatchBounded(map, patch);
}
/** Projector heartbeat handler — the REAL shipped rev-aware snapshot merge. */
function projectorHeartbeat(map: Map<string, LayerWire>, layers: LayerWire[]): void {
  rebuildOverridesFromSnapshot(map, layers);
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

check("race: LEGACY (no-rev) STALE snapshot still regresses transiently, then re-converges (tolerant)", () => {
  const projMap = new Map<string, LayerWire>();
  const patch = { id: "slide", kind: "slide", z: 10, enabled: false } as LayerWire; // NO rev
  projectorPatch(projMap, patch);
  // A stale (empty) legacy snapshot: with no revs anywhere the snapshot is
  // authoritative (clear+rebuild) exactly as before — documents the tolerant
  // pre-hardening behaviour is preserved for un-revved senders.
  projectorHeartbeat(projMap, []);
  assert.equal(projMap.has("slide"), false, "legacy: stale snapshot regressed the patch (flap window)");
  projectorHeartbeat(projMap, operatorSnapshot(operatorApply(new Map(), patch)));
  assert.equal(projMap.get("slide")!.enabled, false, "legacy: re-converged to the patch");
});

// ── (2b) REV HARDENING — stale heartbeat / ghost can't clobber a fresh patch ──
check("hardening: a STALE (older-rev) snapshot does NOT regress a fresher revved patch", () => {
  const projMap = new Map<string, LayerWire>();
  // Steady state: slide visible at rev 100 (from an earlier heartbeat).
  projectorHeartbeat(projMap, [{ id: "slide", kind: "slide", z: 10, enabled: true, rev: 100 } as LayerWire]);
  // Fresh incremental patch hides the slide at a higher rev.
  projectorPatch(projMap, { id: "slide", kind: "slide", z: 10, enabled: false, rev: 200 } as LayerWire);
  assert.equal(projMap.get("slide")!.enabled, false, "fresh patch applied");
  // A lagging ~1Hz heartbeat carrying the OLD (rev 100) slide arrives late.
  projectorHeartbeat(projMap, [{ id: "slide", kind: "slide", z: 10, enabled: true, rev: 100 } as LayerWire]);
  assert.equal(projMap.get("slide")!.enabled, false, "stale heartbeat must NOT regress the fresher patch");
  // The next authoritative heartbeat (folding the patch, rev 200) keeps it.
  projectorHeartbeat(projMap, [{ id: "slide", kind: "slide", z: 10, enabled: false, rev: 200 } as LayerWire]);
  assert.equal(projMap.get("slide")!.enabled, false, "converged, still hidden");
});

check("hardening: a GHOST tab's old-rev snapshot can't clobber a later-origin patch (higher seed)", () => {
  const projMap = new Map<string, LayerWire>();
  // Ghost origin seeded earlier → lower revs. It set background bgA at rev 1000
  // and keeps heartbeating that snapshot.
  const ghostHeartbeat = [{ id: "background", kind: "background", z: 0, enabled: true, payload: bgA, rev: 1000 } as LayerWire];
  projectorHeartbeat(projMap, ghostHeartbeat);
  assert.equal(stackShape(projMap).background.payloadKey, JSON.stringify(bgA), "ghost state adopted first");
  // A freshly-opened operator (seeded from a LATER Date.now()) swaps to bgB at a
  // much higher rev via an incremental patch.
  projectorPatch(projMap, { id: "background", kind: "background", z: 0, enabled: true, payload: bgB, rev: 5_000_000 } as LayerWire);
  assert.equal(stackShape(projMap).background.payloadKey, JSON.stringify(bgB), "fresh operator patch wins");
  // The ghost keeps heartbeating its stale snapshot — must NOT win.
  projectorHeartbeat(projMap, ghostHeartbeat);
  projectorHeartbeat(projMap, ghostHeartbeat);
  assert.equal(stackShape(projMap).background.payloadKey, JSON.stringify(bgB), "ghost heartbeats can never regress the fresher patch");
});

check("hardening: MIXED rev/no-rev is tolerant — no-rev patch applies, revs gate", () => {
  const projMap = new Map<string, LayerWire>();
  // No-rev existing, no-rev patch → applies (legacy).
  projectorPatch(projMap, { id: "logo", kind: "logo", z: 20, enabled: true } as LayerWire);
  projectorPatch(projMap, { id: "logo", kind: "logo", z: 20, enabled: false } as LayerWire);
  assert.equal(projMap.get("logo")!.enabled, false, "no-rev patch applied over no-rev existing");
  // Revved existing, then a no-rev patch → tolerant (applies; can't compare).
  projectorPatch(projMap, { id: "slide", kind: "slide", z: 10, enabled: false, rev: 300 } as LayerWire);
  projectorPatch(projMap, { id: "slide", kind: "slide", z: 10, enabled: true } as LayerWire);
  assert.equal(projMap.get("slide")!.enabled, true, "no-rev patch is tolerant over a revved entry");
  // Revved existing, older revved patch → dropped.
  projectorPatch(projMap, { id: "camera", kind: "camera", z: 5, enabled: true, rev: 500 } as LayerWire);
  projectorPatch(projMap, { id: "camera", kind: "camera", z: 5, enabled: false, rev: 400 } as LayerWire);
  assert.equal(projMap.get("camera")!.enabled, true, "older revved patch dropped");
});

check("hardening: snapshot REMOVAL is honored only when the snapshot is new enough", () => {
  const projMap = new Map<string, LayerWire>();
  // A fresh patch (rev 900) hides the slide.
  projectorPatch(projMap, { id: "slide", kind: "slide", z: 10, enabled: false, rev: 900 } as LayerWire);
  // An OLDER snapshot (max rev 100) that omits the slide must NOT remove it.
  projectorHeartbeat(projMap, [{ id: "background", kind: "background", z: 0, enabled: true, payload: bgA, rev: 100 } as LayerWire]);
  assert.equal(projMap.has("slide"), true, "older snapshot must not drop a fresher patch by omission");
  assert.equal(projMap.get("slide")!.enabled, false, "…and it stays as the patch left it");
  // A NEWER snapshot (max rev 1000) that omits the slide legitimately removes it.
  projectorHeartbeat(projMap, [{ id: "background", kind: "background", z: 0, enabled: true, payload: bgA, rev: 1000 } as LayerWire]);
  assert.equal(projMap.has("slide"), false, "newer snapshot removes the omitted layer");
});

// ── (2c) REV IS UNBOUNDED — a hostile / clock-skewed huge rev PINS a layer ────
// There is NO upper cap on `rev` (isValidLayerWire accepts any finite ≥0). A
// sender that stamps an absurd rev (malice, or a machine whose clock is set far
// in the future so its Date.now() seed dwarfs every honest peer) PERMANENTLY
// pins that layer id on the projector: no legitimate patch (rev ≈ 1.7e12) can
// ever out-rank it, and no honest heartbeat can remove it by omission. This
// test DOCUMENTS the current (unbounded) behaviour so the gap is tracked. The
// blast radius is contained: the layers engine is dormant (LAYERS_V2 default
// OFF, no per-church opt-in wired), and the channel is church-scoped/auth'd, so
// this is 🟡 (would be 🔴 with the engine live). If a cap is ever added, flip
// this test's expectation.
check("rev-cap (Y1a): a hostile huge rev CANNOT pin a layer — the next honest patch self-heals it", () => {
  const projMap = new Map<string, LayerWire>();
  // Hostile / future-clock sender pins the background with a colossal rev. (In a
  // real path isValidLayerWire rejects this at the wire; here we prove the
  // receiver self-heals even if a bad rev somehow reached the map.)
  const HUGE = Number.MAX_SAFE_INTEGER; // 2^53-1 ≫ any honest Date.now() seed
  projectorPatch(projMap, { id: "background", kind: "background", z: 0, enabled: true, payload: bgA, rev: HUGE } as LayerWire);
  assert.equal(stackShape(projMap).background.payloadKey, JSON.stringify(bgA), "hostile pin transiently adopted");
  // An honest operator (rev ≈ Date.now()) swaps the background — the stored rev is
  // absurdly further ahead than the skew window, so the honest patch WINS.
  const honestRev = Date.now(); // ~1.7e12 ≪ HUGE
  projectorPatch(projMap, { id: "background", kind: "background", z: 0, enabled: true, payload: bgB, rev: honestRev } as LayerWire);
  assert.equal(stackShape(projMap).background.payloadKey, JSON.stringify(bgB), "honest patch adopted — hostile pin self-healed");
});

check("wrong-clock-year sender (Y1a): a rev seeded from a future clock can't out-rank honest revs after self-heal", () => {
  const projMap = new Map<string, LayerWire>();
  // Sender whose OS clock is set to ~year 2200 seeds a rev ~7.2e12 (>> honest,
  // >> skew ahead of real now).
  const futureRev = Date.now() + 200 * 365 * 24 * 3600 * 1000;
  projectorPatch(projMap, { id: "background", kind: "background", z: 0, enabled: true, payload: bgA, rev: futureRev } as LayerWire);
  const honestRev = Date.now();
  projectorPatch(projMap, { id: "background", kind: "background", z: 0, enabled: true, payload: bgB, rev: honestRev } as LayerWire);
  assert.equal(stackShape(projMap).background.payloadKey, JSON.stringify(bgB), "honest patch wins over wrong-clock pin");
});

check("honest revs unaffected (Y1a): an ordinary older patch still loses to a newer one (no spurious self-heal)", () => {
  const projMap = new Map<string, LayerWire>();
  const rev1 = Date.now();
  projectorPatch(projMap, { id: "background", kind: "background", z: 0, enabled: true, payload: bgB, rev: rev1 + 5 } as LayerWire);
  // An older honest patch (within the skew window) must still be DROPPED.
  projectorPatch(projMap, { id: "background", kind: "background", z: 0, enabled: true, payload: bgA, rev: rev1 } as LayerWire);
  assert.equal(stackShape(projMap).background.payloadKey, JSON.stringify(bgB), "older honest patch still loses");
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

// ── (4) ORIGIN-EPOCH authority (Y1b) ─────────────────────────────────────────
// A fresh operator tab (higher epoch) authoritatively clears/replaces the
// projector map even with EMPTY overrides (refresh-clears invariant), while a
// ghost OLD-epoch tab can never clobber the live tab.
check("epoch (Y1b): operator refresh with EMPTY overrides clears the projector map", () => {
  const projMap = new Map<string, LayerWire>();
  const epochRef: { current: number | undefined } = { current: undefined };
  const oldEpoch = 1000;
  // Old tab had hidden the logo + swapped bg.
  rebuildOverridesFromSnapshot(projMap, [
    { id: "logo", kind: "logo", z: 20, enabled: false, rev: oldEpoch + 1 } as LayerWire,
    { id: "background", kind: "background", z: 0, enabled: true, payload: bgB, rev: oldEpoch + 2 } as LayerWire,
  ], { snapEpoch: oldEpoch, epochRef });
  assert.equal(projMap.size, 2, "pre-refresh: two overrides on projector");
  // Fresh tab (higher epoch) with NO overrides → map cleared authoritatively.
  rebuildOverridesFromSnapshot(projMap, [], { snapEpoch: oldEpoch + 500, epochRef });
  assert.equal(projMap.size, 0, "fresh-tab empty snapshot cleared the projector map");
  assert.equal(epochRef.current, oldEpoch + 500, "stored epoch advanced to the fresh tab");
});

check("epoch (Y1b): a GHOST old-epoch snapshot can't clobber the live tab's overrides", () => {
  const projMap = new Map<string, LayerWire>();
  const epochRef: { current: number | undefined } = { current: undefined };
  const liveEpoch = 5000;
  // Live tab set a background override.
  rebuildOverridesFromSnapshot(projMap, [
    { id: "background", kind: "background", z: 0, enabled: true, payload: bgA, rev: liveEpoch + 1 } as LayerWire,
  ], { snapEpoch: liveEpoch, epochRef });
  assert.equal(stackShape(projMap).background.payloadKey, JSON.stringify(bgA), "live override present");
  // A ghost tab (older epoch) heartbeats an EMPTY snapshot — must be ignored.
  rebuildOverridesFromSnapshot(projMap, [], { snapEpoch: liveEpoch - 1000, epochRef });
  assert.equal(stackShape(projMap).background.payloadKey, JSON.stringify(bgA), "ghost snapshot did not clobber");
  assert.equal(epochRef.current, liveEpoch, "stored epoch unchanged by ghost");
});

check("epoch (Y1b): mixed legacy (no-epoch) snapshots stay tolerant (rev-gated merge)", () => {
  const projMap = new Map<string, LayerWire>();
  const epochRef: { current: number | undefined } = { current: undefined };
  // Legacy snapshot (no epoch) → merge path, same as before.
  rebuildOverridesFromSnapshot(projMap, [
    { id: "background", kind: "background", z: 0, enabled: true, payload: bgA, rev: 10 } as LayerWire,
  ], { epochRef });
  assert.equal(projMap.size, 1, "legacy snapshot merged");
  assert.equal(epochRef.current, undefined, "no epoch stored from a legacy snapshot");
  // A same-epoch snapshot after an epoch is established keeps the rev-gated merge.
  rebuildOverridesFromSnapshot(projMap, [], { snapEpoch: 2000, epochRef }); // establishes + clears
  assert.equal(epochRef.current, 2000);
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

// ── Ghost-operator base-slide clobber (field wave 6B) ───────────────────────
// The pure eye-toggle logic is correct, but the FIELD failure ("Text off then
// on = no restore") reproduced only with TWO operator instances on one
// BroadcastChannel: an older/idle operator answers the projector's ping with a
// full snapshot carrying live:{kind:"empty"} + no overrides, which clobbered the
// projector's BASE slide. Because a slide "show" carries no payload (R1a), SHOW
// then had nothing to restore. These model the projector's output-branch base
// application exactly as shipped, and prove the origin-epoch guard fixes it.

/** Projector output-branch base-slide + override application, mirroring the
 *  shipped /live handler: a strictly-older-epoch (ghost) snapshot is IGNORED
 *  wholesale; otherwise the base live slide is applied and overrides folded. */
function projectorApplyOutput(
  proj: { base: SlidePayload; map: Map<string, LayerWire>; epoch: EpochRef },
  snap: { live: SlidePayload; layers?: LayerWire[]; layersEpoch?: number },
): void {
  if (isStaleLayersSnapshot(snap.layersEpoch, proj.epoch.current)) return; // ghost
  proj.base = snap.live;
  rebuildOverridesFromSnapshot(proj.map, snap.layers ?? [], { snapEpoch: snap.layersEpoch, epochRef: proj.epoch });
}

check("wave6B: ghost idle operator does NOT blank the base slide → eye SHOW restores", () => {
  const realEpoch = 5000, ghostEpoch = 3000; // ghost tab loaded EARLIER
  const proj = { base: { kind: "empty" } as SlidePayload, map: new Map<string, LayerWire>(), epoch: { current: undefined } as EpochRef };
  const liveText = projectableTextSlide("Adonai");
  // Real operator sends the live slide + enabled slide override.
  projectorApplyOutput(proj, { live: liveText, layers: [{ id: "slide", kind: "slide", z: 10, enabled: true, rev: realEpoch + 1 }], layersEpoch: realEpoch });
  assert.equal((proj.base as { text?: string }).text, "Adonai", "base slide is live");
  // Operator HIDES the slide (eye off) — enabled:false, no payload (R1a).
  projectorApplyOutput(proj, { live: liveText, layers: [{ id: "slide", kind: "slide", z: 10, enabled: false, rev: realEpoch + 2 }], layersEpoch: realEpoch });
  let resolved = resolveLayeredInput({ mode: "live", slide: proj.base }, Array.from(proj.map.values()));
  assert.equal(resolved.slide.kind, "empty", "hidden → projector blank");
  // GHOST idle operator answers a ping with live:empty + no overrides.
  projectorApplyOutput(proj, { live: { kind: "empty" }, layers: [], layersEpoch: ghostEpoch });
  assert.equal((proj.base as { text?: string }).text, "Adonai", "ghost snapshot IGNORED — base slide preserved");
  assert.equal(proj.map.get("slide")?.enabled, false, "ghost did not wipe the slide override either");
  // Operator SHOWS the slide again (eye on) — enabled:true, no payload.
  projectorApplyOutput(proj, { live: liveText, layers: [{ id: "slide", kind: "slide", z: 10, enabled: true, rev: realEpoch + 3 }], layersEpoch: realEpoch });
  resolved = resolveLayeredInput({ mode: "live", slide: proj.base }, Array.from(proj.map.values()));
  assert.equal((resolved.slide as { text?: string }).text, "Adonai", "SHOW restores the live slide (bug fixed)");
});

check("wave6B: guard is INERT single-operator and engine-off (no regression)", () => {
  // Single operator (one epoch): a later same-epoch empty MUST apply (real clear).
  const proj = { base: projectableTextSlide("X") as SlidePayload, map: new Map<string, LayerWire>(), epoch: { current: undefined } as EpochRef };
  projectorApplyOutput(proj, { live: projectableTextSlide("X"), layersEpoch: 7000 });
  projectorApplyOutput(proj, { live: { kind: "empty" }, layersEpoch: 7000 }); // same epoch → applies
  assert.equal(proj.base.kind, "empty", "same-operator real clear still blanks (not over-guarded)");
  // Engine-off / legacy sender (no epoch on the wire): never guarded.
  assert.equal(isStaleLayersSnapshot(undefined, 9000), false, "absent snap epoch ⇒ not stale");
  assert.equal(isStaleLayersSnapshot(9000, undefined), false, "absent stored epoch ⇒ not stale");
  assert.equal(isStaleLayersSnapshot(9000, 9000), false, "equal epoch ⇒ not stale");
  assert.equal(isStaleLayersSnapshot(8999, 9000), true, "older epoch ⇒ stale (ghost)");
  // A FRESH operator refresh (higher epoch) is authoritative, never guarded.
  assert.equal(isStaleLayersSnapshot(9001, 9000), false, "newer epoch ⇒ authoritative, applies");
});

console.log(`\noutput-layers-convergence: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
