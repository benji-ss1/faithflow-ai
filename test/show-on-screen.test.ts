/**
 * "Show on screen" — putting a stage layout on the projector.
 * Run: npx tsx --test test/show-on-screen.test.ts
 *
 * This is the one feature in the set that can put the wrong thing in front of
 * a congregation, so the tests are about the two dangerous properties:
 *   1. a layout on the projector can NEVER black out the room, and
 *   2. a projector-targeted layout can NEVER reach a confidence monitor.
 * Both are structural, not warned about.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isValidStageLayoutList } from "../src/lib/broadcast";
import { sanitizeScreenTarget, TIMER_SCREEN_IDS } from "../src/engine/timers/screens";

const renderer = readFileSync("src/components/live/StageLayoutRenderer.tsx", "utf8");
const shell = readFileSync("src/components/operator/pro/ProOperatorShell.tsx", "utf8");

const layout = { id: "l1", name: "L", background: "#000000", widgets: [] };
// NB: `target === ""` must still SET the field — an empty string is a value we
// are testing the validator rejects, not an absent one. A `target ? …` helper
// silently omitted it and made the test assert the wrong thing.
const entry = (target?: string) => (target === undefined ? { screen: "scr1", layout } : { screen: "scr1", layout, target });

test("an unknown target falls back to STAGE, never to a projector", () => {
  // The failure DIRECTION matters far more than the failure rate: a row we
  // cannot read must land on a confidence monitor, not in front of the room.
  for (const bad of [null, undefined, "", "projector", "MAIN", 42, {}, [], "main; drop"]) {
    assert.equal(sanitizeScreenTarget(bad), "stage", `${JSON.stringify(bad)} must fall back to stage`);
  }
  for (const good of TIMER_SCREEN_IDS) assert.equal(sanitizeScreenTarget(good), good);
});

test("the wire omits target when it is stage, and rejects it when stated", () => {
  // The omit rule is the byte-identical guarantee: a church that has never
  // touched this feature must produce exactly the payload it produced before.
  // Accepting an explicit "stage" would let two different snapshots mean the
  // same thing, which is how a determinism guarantee rots.
  assert.equal(isValidStageLayoutList([entry()]), true, "absent target means stage");
  assert.equal(isValidStageLayoutList([entry("main")]), true);
  assert.equal(isValidStageLayoutList([entry("stage")]), false,
    "an explicit target:'stage' must be rejected — it should have been omitted");
  assert.equal(isValidStageLayoutList([entry("projector")]), false);
  assert.equal(isValidStageLayoutList([entry("")]), false);
});

test("the producer omits it, so the guarantee is not merely hoped for", () => {
  assert.match(shell, /target === "stage"\s*\n?\s*\?\s*\{ screen: sc\.id, layout: toWire\(l\) \}/,
    "toWire must omit target when it is stage");
});

test("the legacy singular field cannot leak a projector layout", () => {
  // /stage falls back to `stageLayout` when it has no ?screen= match. Taking
  // list[0] would put a retargeted FIRST screen's projector layout full-screen
  // on a confidence monitor — the front door guarded, the back door open.
  assert.match(shell, /first: list\.find\(\(e\) => !\("target" in e\)\)\?\.layout/,
    "`first` must be the first STAGE-targeted layout, not list[0]");
  assert.doesNotMatch(shell, /first: list\[0\]\?\.layout/);
});

test("a layout on the projector can never black out the room", () => {
  // THE structural property. In overlay mode the renderer does not read
  // layout.background at all, so no value an operator, a stale wire frame, or
  // a future refactor can set produces a black screen. An empty layout on the
  // projector is a no-op, which is the right failure.
  assert.match(renderer, /mode === "replace" \? layout\.background : "transparent"/,
    "overlay mode must never adopt the layout background");
  assert.match(renderer, /\n  mode: "replace" \| "overlay";/,
    "mode must be REQUIRED, so every call site decides");
});

test("only /stage may render in replace mode", () => {
  for (const f of ["src/app/live/page.tsx", "src/app/livestream/page.tsx", "src/app/ndi/page.tsx"]) {
    let src: string;
    try { src = readFileSync(f, "utf8"); } catch { continue; }
    assert.doesNotMatch(src, /mode="replace"/,
      `${f} renders a stage layout in replace mode — an empty layout there is a black screen`);
  }
  assert.match(readFileSync("src/app/stage/page.tsx", "utf8"), /mode="replace"/,
    "/stage is the one surface a layout may replace");
});

test("the projector overlay sits below timers and messages", () => {
  // It must never cover a countdown or an urgent message.
  const live = readFileSync("src/app/live/page.tsx", "utf8");
  const overlayAt = live.indexOf("mode=\"overlay\"");
  const timerAt = live.indexOf('sceneHidesLayer(scene, "main", "timer")');
  assert.ok(overlayAt > -1 && timerAt > -1);
  assert.ok(overlayAt < timerAt, "the overlay must render before (below) the timer layer");
});

test("the On stage badge cannot be claimed by a projector layout", () => {
  const hook = readFileSync("src/components/operator/pro/right/useStageLayouts.ts", "utf8");
  assert.match(hook, /screens\.find\(\(s2\) => s2\.target === "stage"\)\?\.layoutId/);
});

test("retargeting a screen reports failure instead of silently doing nothing", () => {
  const actions = readFileSync("src/lib/actions.ts", "utf8");
  const fn = actions.slice(actions.indexOf("export async function setStageScreenTarget"));
  assert.match(fn.slice(0, 900), /if \(!res\.rowCount\) return \{ ok: false/,
    "the action that can put something in front of a congregation must not fail silently");
});
