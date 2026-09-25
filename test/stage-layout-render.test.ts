/**
 * The Stage Layout editor must actually DRIVE the stage screen.
 * Run: npx tsx test/stage-layout-render.test.ts
 *
 * This exists because the editor shipped with NO consumer: a church could
 * design a layout, assign it to a screen, and see nothing. Dead scaffolding
 * that looks like a feature is a bug (docs/ONE_TO_ONE_LOOP.md §5), and the only
 * way to stop it recurring is to assert the chain end to end.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isValidStageLayoutWire, sanitizeOutputState, type OutputState } from "../src/lib/broadcast";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

/* ── 1. the chain is unbroken, end to end ────────────────────────────────── */

const shell = read("../src/components/operator/pro/ProOperatorShell.tsx");
assert.ok(/presentflow:stage-layout/.test(shell), "the shell must RESOLVE and emit the assigned layout");
assert.ok(/stageLayouts\.byId\(/.test(shell),
  "it must resolve the id to a real layout — /stage cannot look one up itself");

// MULTI-SCREEN. The first version of this guard asserted the exact line that
// read `screens[0]`, so it would have passed forever while "Stage 2" stayed a
// control that lied — an operator could add a screen, assign a layout, and
// nothing anywhere changed. Assert the BEHAVIOUR instead of the line.
assert.ok(/stageLayouts\.screens\s*\n?\s*\.map\(/.test(shell) || /screens\.map\(/.test(shell),
  "the shell must publish EVERY screen's layout, not just the first");
assert.ok(!/stageLayouts\.screens\[0\]/.test(shell),
  "screens[0] means screens 2..N are inert — the multi-screen UI would be lying");
assert.ok(/stageLayouts\?:/.test(read("../src/lib/broadcast.ts")),
  "OutputState must carry a layout PER SCREEN");
const stagePage = read("../src/app/stage/page.tsx");
assert.ok(/get\("screen"\)/.test(stagePage),
  "/stage must know WHICH screen it is, or every monitor shows the same layout");
assert.ok(/\.find\(\(e\) => e\.screen === screenId\)/.test(stagePage),
  "/stage must pick its OWN layout by screen id");
// 2026-09-25: and it must pick from STAGE-TARGETED entries only, including the
// no-?screen fallback. A projector-targeted layout rendering full-screen on a
// confidence monitor is the specific failure "Show on screen" would otherwise
// introduce — it would cover the words the band is reading.
assert.ok(/e\.target === undefined \|\| e\.target === "stage"/.test(stagePage),
  "/stage must filter to stage-targeted entries before resolving");
assert.ok(/const stageOnly = /.test(stagePage) && /stageOnly\[0\]\?\.layout/.test(stagePage),
  "the no-?screen fallback must use the FILTERED list, not the raw one");

const console_ = read("../src/components/operator/OperatorConsole.tsx");
assert.ok(/presentflow:stage-layout/.test(console_), "the console must listen for it");
assert.ok(/isValidStageLayoutWire\(/.test(console_) && /isValidStageLayoutList\(/.test(console_),
  "and validate BOTH the single layout and the per-screen list — this reaches a live screen");
// BEHAVIOUR, not a byte-exact spread (2026-09-25). This used to pin the
// literal `...(stageLayout ? { stageLayout } : {})`, so adding the clear-all
// suppression condition failed it while the folding still worked perfectly.
assert.ok(/\{ stageLayout \}/.test(console_) && /\{ stageLayouts: stageLayoutList \}/.test(console_),
  "and fold BOTH the single layout and the per-screen list into OutputState");
assert.ok(/stageLayout(List)?[\s\S]{0,400}\]\);/.test(console_.slice(console_.indexOf("{ stageLayouts: stageLayoutList }"))),
  "and keep them in the OutputState effect's dependency list, or a change never republishes");

const stage = read("../src/app/stage/page.tsx");
assert.ok(/<StageLayoutRenderer/.test(stage), "/stage must RENDER it — the whole point");
assert.ok(/msg\.state\.stageLayout/.test(stage), "/stage must read it off OutputState");

/* ── 2. NO REGRESSION: no layout ⇒ the existing screen, untouched ────────── */

assert.ok(/if \(myLayout\) \{/.test(stage),
  "the layout path must be a guarded EARLY RETURN, so the existing screen is the fallback");
assert.ok(/flex-col"\n\s*style=\{\{ margin: 0, padding: 0, background: "#000"/.test(stage)
  || /background: "#000", color: "#e9edee"/.test(stage),
  "the original hardcoded stage screen must still exist below the guard");

/* ── 3. a malformed layout falls back rather than blanking a monitor ─────── */

const poisoned = {
  live: { kind: "empty" },
  stageLayout: { id: "x", background: "not-a-colour", widgets: [] },
} as unknown as OutputState;
const cleaned = sanitizeOutputState(poisoned);
assert.ok(cleaned, "a bad layout must not reject the whole snapshot");
assert.equal((cleaned as { stageLayout?: unknown }).stageLayout, undefined,
  "the bad layout is dropped, so /stage falls back to its existing screen");

/* ── 4. colours are hex-only — they go straight into a style attribute ───── */

const withCssInjection = {
  id: "l1", background: "#000000",
  widgets: [{
    id: "w1", kind: "timer", rect: { x: 0, y: 0, w: 0.5, h: 0.2 },
    scale: 1, align: "center", zIndex: 0,
    color: "red; background:url(javascript:alert(1))",
  }],
};
assert.equal(isValidStageLayoutWire(withCssInjection), false, "a non-hex colour must be rejected");

const good = { ...withCssInjection, widgets: [{ ...withCssInjection.widgets[0], color: "#4ade80" }] };
assert.equal(isValidStageLayoutWire(good), true, "a hex colour passes");

/* ── 5. bounds hold ──────────────────────────────────────────────────────── */

const many = { ...good, widgets: Array.from({ length: 25 }, (_, i) => ({ ...good.widgets[0], id: `w${i}` })) };
assert.equal(isValidStageLayoutWire(many), false, "widget count is capped");

const offCanvas = { ...good, widgets: [{ ...good.widgets[0], rect: { x: 5, y: 0, w: 0.5, h: 0.2 } }] };
assert.equal(isValidStageLayoutWire(offCanvas), false, "a rect outside the canvas is rejected");

const dupes = { ...good, widgets: [good.widgets[0], { ...good.widgets[0] }] };
assert.equal(isValidStageLayoutWire(dupes), false, "duplicate widget ids would break React keys");

const poison = JSON.parse('{"id":"l","background":"#000000","widgets":[],"__proto__":{"x":1}}');
assert.equal(isValidStageLayoutWire(poison), false, "prototype pollution is rejected");

/* ── 6. a broken binding is VISIBLE, not silently empty ──────────────────── */

const renderer = read("../src/components/live/StageLayoutRenderer.tsx");
assert.ok(/const UNBOUND = "—"/.test(renderer),
  "an unbound/deleted timer must render a dash so the operator SEES the break");
assert.ok(/if \(!t\) \{\s*\n\s*text = UNBOUND;/.test(renderer), "and that must actually be used");

/* ── 7. the renderer ticks, and ticks in the sender's clock ──────────────── */

assert.ok(/computeRemainingSec\(def, rt, now\)/.test(renderer), "timers must be computed, not read frozen");
assert.ok(/senderNow\(clockSync\)/.test(renderer), "in the SENDER's domain, or a skewed device reads wrong");
assert.ok(/if \(!needsTick\) return;/.test(renderer),
  "a layout of static text must not mount an interval");

/* ── 8. the widget's format wins over the timer's own ────────────────────── */
// Two stage screens should be able to show the same timer differently.
assert.ok(/showHours: w\.showHours \?\? t\.showHours/.test(renderer),
  "the widget's format overrides the timer's, so per-screen formatting works");

console.log("stage-layout-render: all guards passed");
