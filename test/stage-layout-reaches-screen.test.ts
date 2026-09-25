/**
 * The stage layout must actually REACH the screen.
 * Run: npx tsx --test test/stage-layout-reaches-screen.test.ts
 *
 * 2026-09-25, found by an agent asked to DISPROVE a claim rather than confirm
 * it: `dispatchInternal` wraps its value as `{ nonce, payload }`, but the
 * OperatorConsole listeners read `detail.first` / `detail.list` / the raw
 * `detail` — all undefined. So `stageLayout`, `stageLayoutList` and
 * `timersWire` were set to NULL on every single dispatch, and no
 * operator-designed layout ever reached /stage on the same-machine path.
 *
 * The whole feature was dead end to end. Every test that "covered" it only
 * grepped that the event NAME appeared in both files — which it did, on both
 * sides of a connection that was never made. That is why these tests assert
 * the SHAPE the listener actually reads, not the presence of a string.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const console_ = readFileSync("src/components/operator/OperatorConsole.tsx", "utf8");
const events = readFileSync("src/lib/internal-events.ts", "utf8");

test("dispatchInternal still wraps the value under `payload`", () => {
  // If this ever changes, the assertions below are measuring the wrong thing.
  assert.match(events, /const detail: InternalEventDetail<T> = \{ nonce: INTERNAL_NONCE, payload \}/);
});

test("every internal listener unwraps with internalPayload", () => {
  // Reading `(e as CustomEvent).detail` hands the validator the WRAPPER. It
  // never validates, so the state silently becomes null and the feature is
  // dead with no error anywhere.
  for (const ev of ["presentflow:stage-layout", "presentflow:timers-wire"]) {
    const at = console_.indexOf(ev);
    assert.ok(at > -1, `${ev} listener is gone`);
    // Look at the handler defined just above the addEventListener call.
    const region = console_.slice(Math.max(0, at - 900), at);
    assert.match(region, /internalPayload[<(]/,
      `the ${ev} handler reads the raw detail instead of internalPayload — the payload is at detail.payload`);
  }
});

test("every listener for a dispatchInternal event unwraps the payload", () => {
  // DERIVED, and deliberately narrow. A first version banned
  // `(e as CustomEvent).detail` outright and flagged six handlers that were
  // perfectly correct — they listen for PLAIN CustomEvents, where .detail IS
  // the payload. Only events dispatched through dispatchInternal carry the
  // { nonce, payload } wrapper, so only those listeners must unwrap.
  const src = readdirSync("src", { recursive: true }) as string[];
  const files = src
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => join("src", f))
    .filter((f) => { try { return statSync(f).isFile(); } catch { return false; } });

  const internalNames = new Set<string>();
  for (const f of files) {
    for (const m of readFileSync(f, "utf8").matchAll(/dispatchInternal[<(][^"']*["']([^"']+)["']/g)) {
      internalNames.add(m[1]);
    }
  }
  assert.ok(internalNames.size >= 2,
    `only found ${internalNames.size} dispatchInternal events — the derivation has broken and this guard is blind`);

  const offenders: string[] = [];
  for (const f of files) {
    const body = readFileSync(f, "utf8");
    for (const name of internalNames) {
      let at = body.indexOf(`addEventListener("${name}"`);
      while (at > -1) {
        const region = body.slice(Math.max(0, at - 900), at);
        if (/\(e as CustomEvent\)\.detail/.test(region) && !/internalPayload[<(]/.test(region)) {
          offenders.push(`${f} → ${name}`);
        }
        at = body.indexOf(`addEventListener("${name}"`, at + 1);
      }
    }
  }
  assert.deepEqual(offenders, [],
    `these listeners read the WRAPPER instead of the payload, so their state silently becomes null:\n  ${offenders.join("\n  ")}`);
});

test("/stage does not dedupe away a frame whose only change is the layout", () => {
  // The non-slide fields are applied only when a signature changes. That
  // signature omitted the layout, so removing it (clear-all) or assigning a new
  // one produced an identical signature and was never applied — the monitor
  // kept the last-good layout straight through the operator's panic button.
  const page = readFileSync("src/app/stage/page.tsx", "utf8");
  const sig = page.slice(page.indexOf("restSig = JSON.stringify("), page.indexOf("} catch { restSig"));
  for (const f of ["stageLayout", "stageLayouts", "timersWire"]) {
    assert.ok(sig.includes(f), `restSig omits ${f} — a change to it alone would be deduped away`);
  }
});

// ── which scene layer masks which widget kind ─────────────────────────────
// This matrix was unlocked, so the next layer added would silently go
// unmasked — which is exactly how "Pre-Service hides the words" ended up NOT
// hiding the words on a stage layout.
import { SCENE_SCREENS, SCENE_LAYER_IDS, sceneHidesLayer, type SceneWire } from "../src/lib/scenes";
import { TIMER_SCREEN_IDS } from "../src/engine/timers/screens";
import { STAGE_WIDGET_KINDS } from "../src/engine/stage";

test("the scene screens and the timer screens are the same set", () => {
  // StageLayoutRenderer casts SceneScreen → TimerScreenId. If a fifth scene
  // screen is ever added, that cast becomes a lie and timers silently stop
  // being routed on it. Fail the build instead.
  assert.deepEqual([...SCENE_SCREENS].sort(), [...TIMER_SCREEN_IDS].sort(),
    "SCENE_SCREENS and TIMER_SCREEN_IDS have drifted — the cast in StageLayoutRenderer is no longer honest");
});

test("the widget-kind to scene-layer mapping is complete and deliberate", () => {
  // Every widget kind must have a DECIDED answer for every layer: either it is
  // masked by it, or it is deliberately not. An unlisted pair is an oversight.
  const MASKED_BY: Record<string, string[]> = {
    current_text: ["slide"],
    next_text: ["slide"],
    slide_preview: ["slide"],
    timer: ["timer"],
    // Deliberately unmasked:
    //  clock       — a wall clock is not any scene layer
    //  message     — this is OutputState.operatorMessage, a different field
    //                from `announcement`, masked by nothing anywhere in the
    //                app and with no layer of its own in SceneLayerId
    //  static_text — a label the operator typed; a scene has no say over it
    clock: [],
    message: [],
    static_text: [],
  };
  for (const kind of STAGE_WIDGET_KINDS) {
    assert.ok(kind in MASKED_BY,
      `widget kind "${kind}" has no decided scene-layer mapping — add it to this matrix, even if the answer is "none"`);
  }
  for (const layers of Object.values(MASKED_BY)) {
    for (const l of layers) {
      assert.ok((SCENE_LAYER_IDS as readonly string[]).includes(l), `"${l}" is not a real scene layer`);
    }
  }
});

test("the renderer actually implements that matrix", () => {
  const r = readFileSync("src/components/live/StageLayoutRenderer.tsx", "utf8");
  assert.match(r, /sceneHidesLayer\(scene, screen, "slide"\)/,
    "the words must be maskable — the built-in Pre-Service scene hides the slide layer on stage");
  assert.match(r, /current_text"[\s\S]{0,80}next_text"[\s\S]{0,80}slide_preview"/,
    "all three slide-bearing kinds must be masked together");
  assert.doesNotMatch(r, /w\.kind === "message" && sceneHidesLayer/,
    "operatorMessage is not the announcement layer — masking it invented a rule the rest of the app does not have");
});

test("a hostile scene cannot take the stage screen down", () => {
  // Fail-open: a garbage scene must hide nothing rather than throw.
  for (const bad of [null, undefined, {}, { screens: null }, { screens: { stage: null } },
                     { screens: { stage: { layers: null } } }, "nope", 42, []] as unknown[]) {
    assert.doesNotThrow(() => sceneHidesLayer(bad as SceneWire | null, "stage", "timer"));
    assert.equal(sceneHidesLayer(bad as SceneWire | null, "stage", "timer"), false,
      "a malformed scene must hide NOTHING, never blank a live screen");
  }
});
