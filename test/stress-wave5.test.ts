/**
 * STRESS wave 5 (relaunch) — adversarial coverage for the feat/decoupling-layers-panel
 * delta f10760c..HEAD. Attacks the four pure-testable surfaces from the stress
 * mandate:
 *   (1) 5A hide/show storms + convergence (layer-store + resolver + wire pipeline)
 *   (2) paste clamp/gating storms (slide-paste)
 *   (3) engine cue-sheet at scale + boundary nav (200-item/50-header plan)
 *   (4) dispatchAction malformed-object tolerance
 *
 * Run: npx tsx test/stress-wave5.test.ts
 */
import assert from "node:assert/strict";
import { reconcileBackgroundOnBaseChange, shouldRearmSlideOnSend } from "../src/lib/layer-store";
import { resolveLayeredInput } from "../src/lib/output-layers-render";
import {
  outputStateToLayers,
  applyLayerPatchBounded,
  rebuildOverridesFromSnapshot,
  type EpochRef,
} from "../src/lib/output-layers";
import { pasteInsertIndex, pasteDisabledReason, canPasteSlide } from "../src/lib/slide-paste";
import { buildCueSheet, nextCue, prevCue, cueAt } from "../src/engine/cue-sheet";
import { dispatchAction, type EngineAction } from "../src/engine/actions";
import {
  projectableTextSlide,
  type BackgroundSpec,
  type LayerWire,
  type OutputState,
  type SlidePayload,
} from "../src/lib/broadcast";
import type { PlanInput } from "../src/lib/output-plan";
import type { ExpandedPlan, ExpandedItem } from "../src/lib/server/services";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}

const textSlide = projectableTextSlide("John 3:16");
const shaderBg: BackgroundSpec = { type: "shader", shaderPreset: "cleanSlate" } as BackgroundSpec;
const imageBg: BackgroundSpec = { type: "image", imageUrl: "https://x/y.jpg" } as BackgroundSpec;
const mediaBg: BackgroundSpec = { type: "video", videoUrl: "https://x/clip.mp4" } as BackgroundSpec;

function deriveBase(state: Partial<OutputState>): LayerWire[] {
  const full = {
    live: textSlide, next: null, itemTitle: "", slideNumber: "", aspectRatio: "16:9",
    fitMode: "contain", safeArea: false, operatorMessage: null, lowerThird: null, countdownEndsAt: null,
    background: null, appearance: null, videoInput: null, ...state,
  } as OutputState;
  return outputStateToLayers(full, { mode: "live" });
}

function buildVisPatch(base: LayerWire, enabled: boolean): LayerWire {
  const common = { id: base.id, z: base.z, enabled, zone: base.zone, opacity: base.opacity, transportScope: base.transportScope };
  switch (base.kind) {
    case "slide": case "media": return { ...common, kind: base.kind } as LayerWire;
    case "background": return { ...common, kind: "background", payload: (base as { payload?: BackgroundSpec | null }).payload ?? null } as LayerWire;
    case "camera": return { ...common, kind: "camera", payload: (base as { payload?: unknown }).payload } as LayerWire;
    case "logo": return { ...common, kind: "logo" } as LayerWire;
    default: return base;
  }
}

// A single-operator → single-projector wire harness with epoch authority.
function makeWire(input: PlanInput, baseState: Partial<OutputState>) {
  const base = deriveBase(baseState);
  const opMap = new Map<string, LayerWire>();
  const projMap = new Map<string, LayerWire>();
  const epochRef: EpochRef = { current: undefined };
  let epoch = Date.now();
  let rev = epoch;
  const emit = (p: LayerWire) => { const s = { ...p, rev: ++rev }; opMap.set(s.id, s); applyLayerPatchBounded(projMap, s); };
  const heartbeat = () => rebuildOverridesFromSnapshot(projMap, Array.from(opMap.values()), { snapEpoch: epoch, epochRef });
  const resolved = () => resolveLayeredInput(input, Array.from(projMap.values()));
  // Simulate an operator refresh: a NEW tab mints a higher epoch and its OWN
  // (empty) override map. The heartbeat from that fresh tab must authoritatively
  // clear the projector map.
  const refresh = () => { epoch = Date.now() + 1000; rev = epoch; opMap.clear(); heartbeat(); };
  return { base, opMap, projMap, emit, heartbeat, resolved, refresh };
}

// ════════════════════════════════════════════════════════════════════════════
// (1) HIDE / SHOW STORMS
// ════════════════════════════════════════════════════════════════════════════

check("storm: hide→advance→theme-apply(reset none)→show restores base bg (hidden preserved)", () => {
  // Operator hides the background, advances several slides (base bg unchanged),
  // then applies a theme (which resets the base store to none). Per reconcile,
  // a HIDDEN override must NOT be clobbered. SHOW must restore the shader bg.
  const w = makeWire({ mode: "live", slide: textSlide, background: shaderBg }, { background: shaderBg });
  const bgBase = w.base.find((l) => l.id === "background")!;
  w.heartbeat();
  // HIDE
  w.emit(buildVisPatch(bgBase, false));
  w.heartbeat();
  assert.equal(w.resolved().background, null, "hidden → nothing paints");
  // theme-apply resets base store to none: decision for a HIDDEN override.
  const dec = reconcileBackgroundOnBaseChange(w.opMap.get("background"), null);
  assert.deepEqual(dec, { emitSwap: false, spec: null }, "hidden bg not clobbered by theme reset");
  // SHOW (seed from existing override → still carries shaderBg payload)
  w.emit(buildVisPatch(w.opMap.get("background")!, true));
  w.heartbeat();
  assert.equal(w.resolved().background, shaderBg, "SHOW restores the original shader bg");
});

check("storm: hide bg → set media-as-background → show ⇒ MEDIA wins (real new pick out-ranks hidden)", () => {
  // While the bg override is HIDDEN, the operator sets a media asset as the base
  // background. reconcile sees a REAL new base → emitSwap to the media spec,
  // which out-ranks the stale hidden override. SHOW then shows the MEDIA bg,
  // NOT the pre-hide shader.
  const w = makeWire({ mode: "live", slide: textSlide, background: mediaBg }, { background: shaderBg });
  const bgBase = w.base.find((l) => l.id === "background")!;
  w.heartbeat();
  w.emit(buildVisPatch(bgBase, false)); // hide (payload still shader)
  w.heartbeat();
  const dec = reconcileBackgroundOnBaseChange(w.opMap.get("background"), mediaBg);
  assert.deepEqual(dec, { emitSwap: true, spec: mediaBg }, "real media pick out-ranks hidden override");
  // The hook would emit swapBackground(mediaBg): enabled since type!=none.
  w.emit({ id: "background", kind: "background", z: bgBase.z, enabled: true, zone: bgBase.zone, opacity: 1, payload: mediaBg });
  w.heartbeat();
  assert.equal(w.resolved().background, mediaBg, "media background wins after set-as-background");
});

check("storm: hide → operator refresh (fresh tab, empty overrides) ⇒ layer RESURRECTS to base", () => {
  // DOCUMENTED invariant (Y1b): a fresh operator tab authoritatively clears the
  // projector override map. A previously eye-hidden layer therefore RESURRECTS —
  // the projector converges to the pure derived base (bg showing again).
  const w = makeWire({ mode: "live", slide: textSlide, background: shaderBg }, { background: shaderBg });
  const bgBase = w.base.find((l) => l.id === "background")!;
  w.heartbeat();
  w.emit(buildVisPatch(bgBase, false));
  w.heartbeat();
  assert.equal(w.resolved().background, null, "hidden pre-refresh");
  w.refresh();
  assert.equal(w.projMap.size, 0, "fresh tab authoritatively cleared the projector map");
  assert.equal(w.resolved().background, shaderBg, "layer resurrects to base after operator refresh");
});

check("storm: hide slide → AI send fires re-arm ⇒ EYE-hide PERSISTS (slide stays blank)", () => {
  // shouldRearmSlideOnSend is the guard the hook consults on every send. An
  // eye-hidden slide must survive an AI auto-fire/send (eye persists).
  const eyeHiddenSlide: LayerWire = { id: "slide", kind: "slide", z: 10, enabled: false, zone: { kind: "full" }, opacity: 1 };
  assert.equal(shouldRearmSlideOnSend(eyeHiddenSlide, /*eyeHidden*/ true), false, "eye-hide persists on send");
  // A CLEAR-style block (not eye-hidden) must re-arm so it can't swallow output.
  assert.equal(shouldRearmSlideOnSend(eyeHiddenSlide, /*eyeHidden*/ false), true, "clear-block re-arms on send");
});

check("storm: 200 rapid hide/show flips converge to the LAST intent (no drift)", () => {
  const w = makeWire({ mode: "live", slide: textSlide, background: shaderBg }, { background: shaderBg });
  const bgBase = w.base.find((l) => l.id === "background")!;
  w.heartbeat();
  let enabled = true;
  for (let i = 0; i < 200; i++) {
    enabled = !enabled;
    w.emit(buildVisPatch(w.opMap.get("background") ?? bgBase, enabled));
  }
  w.heartbeat();
  // Last flip: 200 toggles starting from enabled=true → ends disabled (even count
  // of flips from true lands on true? track precisely): start true, flip 200×.
  const expectShowing = enabled; // whatever the loop ended on
  assert.equal(w.resolved().background === shaderBg, expectShowing, "converges to last intent");
  assert.equal(w.projMap.get("background")!.enabled, expectShowing, "projector agrees with operator");
});

// ════════════════════════════════════════════════════════════════════════════
// (2) PASTE storms
// ════════════════════════════════════════════════════════════════════════════

check("paste: 50 rapid inserts each clamp into range (never drops the slide)", () => {
  for (let len = 0; len < 50; len++) {
    for (const req of [-999, -1, 0, len, len + 1, len + 999, NaN, 1.9, Infinity, -Infinity]) {
      const at = pasteInsertIndex(req, len);
      assert.ok(at >= 0 && at <= len && Number.isInteger(at), `clamp ${req}@${len} → ${at} in [0,${len}]`);
    }
  }
});

check("paste: gating flips with previewed item (song→bible→media)", () => {
  assert.equal(canPasteSlide(true, /*song*/ true), true, "clipboard + editable song → allowed");
  assert.equal(canPasteSlide(true, /*song*/ false), false, "switch to bible/media → blocked");
  assert.equal(canPasteSlide(false, true), false, "no clipboard → blocked");
  // reason strings are non-empty + distinct so the tooltip always explains why
  const r1 = pasteDisabledReason(false, true);
  const r2 = pasteDisabledReason(true, false);
  assert.ok(r1 && r1.length > 0 && r2 && r2.length > 0 && r1 !== r2, "distinct honest reasons");
});

check("paste: 1.9 truncates to 1 (no fractional splice index)", () => {
  assert.equal(pasteInsertIndex(1.9, 5), 1);
  assert.equal(pasteInsertIndex(-0.5, 5), 0);
});

// ════════════════════════════════════════════════════════════════════════════
// (3) CUE SHEET at scale + boundary nav
// ════════════════════════════════════════════════════════════════════════════

function bigPlan(items: number, headerEvery: number): ExpandedPlan {
  const arr: ExpandedItem[] = [];
  for (let i = 0; i < items; i++) {
    const isHeader = headerEvery > 0 && i % headerEvery === 0;
    const slides: SlidePayload[] = isHeader ? [] : [projectableTextSlide(`s${i}-0`), projectableTextSlide(`s${i}-1`)];
    arr.push({ id: `item-${i}`, order: i, type: isHeader ? "header" : "song", title: `Item ${i}`, slides } as ExpandedItem);
  }
  return { id: "plan", title: "Big", items: arr, blankBgColor: "#000" };
}

check("cue-sheet: 200-item / 50-header plan builds header-free & fast", () => {
  const plan = bigPlan(200, 4); // every 4th = header (50 headers)
  const headers = plan.items.filter((i) => i.type === "header").length;
  assert.equal(headers, 50, "50 headers in fixture");
  const t0 = Date.now();
  const sheet = buildCueSheet(plan);
  const ms = Date.now() - t0;
  // 150 content items × 2 slides = 300 cues; zero header cues.
  assert.equal(sheet.length, 300, "300 content cues, headers contribute none");
  assert.ok(sheet.every((c) => !c.isHeader && c.itemType !== "header"), "no header cue leaked");
  assert.ok(ms < 100, `build under 100ms (was ${ms}ms)`);
});

check("cue-sheet: boundary nav — first, last, and stepping over header runs", () => {
  const plan = bigPlan(200, 4);
  const sheet = buildCueSheet(plan);
  const first = sheet[0];
  const last = sheet[sheet.length - 1];
  // prevCue at the very first content cue → null (start).
  assert.equal(prevCue(plan, sheet, { itemIdx: first.itemIdx, slideIdx: first.slideIdx }), null, "no prev before first");
  // nextCue at the very last content cue → null (end).
  assert.equal(nextCue(plan, sheet, { itemIdx: last.itemIdx, slideIdx: last.slideIdx }), null, "no next after last");
  // Walking the whole sheet forward from the first cue visits every content cue.
  let cur = { itemIdx: first.itemIdx, slideIdx: first.slideIdx };
  let visited = 1;
  for (;;) {
    const n = nextCue(plan, sheet, cur);
    if (!n) break;
    cur = { itemIdx: n.itemIdx, slideIdx: n.slideIdx };
    visited++;
    assert.ok(visited <= sheet.length, "no infinite loop / revisit");
  }
  assert.equal(visited, sheet.length, "forward walk visits every content cue, skipping all headers");
});

check("cue-sheet: all-headers plan → empty sheet, nav returns null (no crash)", () => {
  const plan = bigPlan(20, 1); // every item a header
  const sheet = buildCueSheet(plan);
  assert.equal(sheet.length, 0, "no content → empty sheet");
  assert.equal(cueAt(sheet, { itemIdx: 0, slideIdx: 0 }), null, "cueAt on empty → null");
  assert.equal(nextCue(plan, sheet, { itemIdx: 0, slideIdx: 0 }), null, "nextCue on all-headers → null");
  assert.equal(prevCue(plan, sheet, { itemIdx: 5, slideIdx: 0 }), null, "prevCue on all-headers → null");
});

check("cue-sheet: item with slides:undefined tolerated (fail-soft to [])", () => {
  const plan: ExpandedPlan = {
    id: "p", title: "t", blankBgColor: "#000",
    items: [{ id: "a", order: 0, type: "song", title: "A", slides: undefined as unknown as SlidePayload[] }] as ExpandedItem[],
  };
  const sheet = buildCueSheet(plan);
  assert.equal(sheet.length, 0, "undefined slides contributes no cues, no throw");
});

// ════════════════════════════════════════════════════════════════════════════
// (4) dispatchAction malformed-object tolerance
// ════════════════════════════════════════════════════════════════════════════

function makeCtx() {
  const calls: string[] = [];
  const rec = (n: string) => (..._a: unknown[]) => { calls.push(n); };
  const ctx = {
    onJumpSlide: rec("onJumpSlide"), onSetPreviewItem: rec("onSetPreviewItem"),
    onSendToLive: rec("onSendToLive"), onSendSlideToLive: rec("onSendSlideToLive"),
    onStageSlide: rec("onStageSlide"), onClearSlide: rec("onClearSlide"),
    onClearMedia: rec("onClearMedia"), onClearLowerThird: rec("onClearLowerThird"),
    onBlank: rec("onBlank"), onLogo: rec("onLogo"), onKill: rec("onKill"),
    onSendMessage: rec("onSendMessage"), onClearMessage: rec("onClearMessage"),
    onSendLowerThird: rec("onSendLowerThird"), onSetAnnouncement: rec("onSetAnnouncement"),
    onSetTransitionSpec: rec("onSetTransitionSpec"), onStartCountdown: rec("onStartCountdown"),
    onOpenProjector: rec("onOpenProjector"), onOpenStage: rec("onOpenStage"), onOpenStream: rec("onOpenStream"),
    liveLayers: {
      rows: [{ id: "background", enabled: true }, { id: "slide", enabled: false }],
      clearLayer: rec("clearLayer"), clearAll: rec("clearAll"),
      toggleLayer: rec("toggleLayer"), swapBackground: rec("swapBackground"),
    },
  } as unknown as Parameters<typeof dispatchAction>[0];
  return { ctx, calls };
}

check("dispatch: unknown action type is a tolerant no-op (no throw)", () => {
  const { ctx, calls } = makeCtx();
  assert.doesNotThrow(() => dispatchAction(ctx, { type: "NOT_A_REAL_ACTION" } as unknown as EngineAction));
  assert.doesNotThrow(() => dispatchAction(ctx, {} as unknown as EngineAction));
  assert.doesNotThrow(() => dispatchAction(ctx, { type: null } as unknown as EngineAction));
  assert.equal(calls.length, 0, "malformed actions touched nothing");
});

check("dispatch: known action with MISSING fields still dispatches without throwing", () => {
  const { ctx, calls } = makeCtx();
  assert.doesNotThrow(() => dispatchAction(ctx, { type: "GO_SLIDE" } as unknown as EngineAction), "GO_SLIDE w/o idx");
  assert.doesNotThrow(() => dispatchAction(ctx, { type: "SEND_MESSAGE" } as unknown as EngineAction), "SEND_MESSAGE w/o text");
  assert.doesNotThrow(() => dispatchAction(ctx, { type: "SET_BACKGROUND" } as unknown as EngineAction), "SET_BACKGROUND w/o spec");
  assert.ok(calls.includes("onJumpSlide") && calls.includes("onSendMessage") && calls.includes("swapBackground"));
});

check("dispatch: SET_LAYER_VISIBILITY is idempotent (only toggles on a real diff)", () => {
  const { ctx, calls } = makeCtx();
  // bg already enabled → asking enabled:true must NOT toggle.
  dispatchAction(ctx, { type: "SET_LAYER_VISIBILITY", id: "background", enabled: true });
  assert.equal(calls.filter((c) => c === "toggleLayer").length, 0, "no-op when already at target");
  // bg enabled → asking enabled:false → toggles once.
  dispatchAction(ctx, { type: "SET_LAYER_VISIBILITY", id: "background", enabled: false });
  assert.equal(calls.filter((c) => c === "toggleLayer").length, 1, "toggles once on real diff");
  // unknown row id → no toggle, no throw.
  assert.doesNotThrow(() => dispatchAction(ctx, { type: "SET_LAYER_VISIBILITY", id: "ghost", enabled: false }));
  assert.equal(calls.filter((c) => c === "toggleLayer").length, 1, "unknown id → still one toggle total");
});

check("dispatch: todo-wired + engine-only actions are silent no-ops (no throw, no ctx touch)", () => {
  const { ctx, calls } = makeCtx();
  for (const a of [
    { type: "SET_BACKGROUND_MEDIA", assetRef: { id: "x", url: "u", fileName: "f", kind: "image" } },
    { type: "TRIGGER_MACRO", macroId: "m" },
    { type: "SET_LOOK", lookId: "l" },
    { type: "TOGGLE_PROP", propId: "p", visible: true },
  ] as EngineAction[]) {
    assert.doesNotThrow(() => dispatchAction(ctx, a));
  }
  assert.equal(calls.length, 0, "no ctx handler fired for deferred actions");
});

console.log(`\nstress-wave5: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
