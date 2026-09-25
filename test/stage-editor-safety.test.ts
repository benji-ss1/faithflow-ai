/**
 * The findings from the 2026-09-25 six-agent attack pass on the stage editor.
 * Run: npx tsx --test test/stage-editor-safety.test.ts
 *
 * Every test here is a bug that was actually found by trying to destroy the
 * feature, not a hypothetical. The comments say what went wrong, because a
 * guard whose reason is forgotten is a guard that gets deleted.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { callAction } from "../src/lib/action-call";

const panel = readFileSync("src/components/operator/pro/right/StageLayoutPanel.tsx", "utf8");
const modal = readFileSync("src/components/operator/pro/right/StageLayoutEditorModal.tsx", "utf8");
const inspector = readFileSync("src/components/operator/pro/right/StageInspector.tsx", "utf8");
const canvas = readFileSync("src/components/operator/pro/right/StageCanvas.tsx", "utf8");
const hook = readFileSync("src/components/operator/pro/right/useStageLayouts.ts", "utf8");

test("a refused action is reported, not swallowed", async () => {
  // callAction only fired onError from its CATCH, so an action that politely
  // returned {ok:false} ("Give the layout a name") failed in total silence —
  // and the stage editor then closed and threw away the whole design.
  let shown = "";
  const res = await callAction("save it", async () => ({ ok: false as const, error: "Give the layout a name" }), (m) => { shown = m; });
  assert.equal(res.ok, false);
  assert.equal(shown, "Give the layout a name", "a returned refusal must reach the operator");
});

test("the editor only closes when the save actually succeeded", () => {
  // `await api.save(...); setEditing(null)` closed regardless, so a rejected
  // name or an offline laptop destroyed five minutes of work with no way back.
  assert.match(hook, /save: \(id: string, layout: StageLayout\) => Promise<boolean>/,
    "save must report whether it saved");
  assert.match(panel, /if \(!\(await api\.save\(l\.id, l\)\)\) return;/,
    "the panel must not close the editor on a failed save");
});

test("tapping the pencil cannot blank a live stage screen", () => {
  // A screen on "Default" is a WORKING display. Creating a blank layout and
  // assigning it before the editor opened turned the monitor black the instant
  // the operator tapped the pencil to look — and discarding did not undo it,
  // because the assignment was already written.
  assert.match(panel, /assignTo/, "assignment must be deferred to a successful save");
  assert.match(panel, /if \(editing\.assignTo\) await api\.assign/,
    "the screen must be pointed at the layout only AFTER it saves");
  const open = panel.slice(panel.indexOf("const openEditor"), panel.indexOf("// ── the editor is a modal"));
  const blankBranch = open.slice(0, open.indexOf("if (source?.builtIn)"));
  assert.doesNotMatch(blankBranch, /await api\.assign\(/,
    "the blank branch must not assign before the operator has designed anything");
});

test("assignment failure never leaves the operator editing an unattached layout", () => {
  assert.match(hook, /assign: \(screenId: string, layoutId: string \| null\) => Promise<boolean>/);
});

test("the screen row is not a button inside a button", () => {
  // Invalid HTML: the server parser closes the outer <button> at the inner
  // one, so the SSR and client trees differ, and Safari collapses nested
  // interactive elements in its accessibility tree. The old code's
  // `e.stopPropagation()` on the pencil is the tell — it only exists because
  // the click was bubbling to an enclosing button.
  assert.match(panel, /<div className="flex items-center gap-2 text-left">/,
    "the screen row wrapper must be a div");
  assert.doesNotMatch(panel, /e\.stopPropagation\(\); void openEditor/,
    "the pencil should not need to stop propagation — that means it is nested");
  assert.match(panel, /aria-label=\{`Edit the layout on \$\{sc\.name\}`\}/,
    "the pencil must still be its own labelled button");
});

test("Escape inside a field does not pop the discard dialog", () => {
  // Radix listens at the document, so Escape to clear a half-typed number
  // bubbled up and asked to discard everything.
  assert.match(inspector, /if \(e\.key === "Escape"\) e\.stopPropagation\(\)/,
    "number fields must not let Escape reach the dialog");
  assert.ok((modal.match(/Escape"\) e\.stopPropagation/g) ?? []).length >= 1,
    "selects must not let Escape reach the dialog either");
});

test("a half-typed coordinate does not collapse the widget", () => {
  // Number("") is 0 and finite, so backspacing to retype snapped the box to a
  // 1% sliver and rewrote the field under the cursor.
  assert.match(inspector, /if \(raw\.trim\(\) === ""\) return;/);
});

test("a widget can be resized without a mouse", () => {
  // The handle was a bare <span>: no role, no tab stop, and an aria-label a
  // screen reader would not surface. Keyboard users could move but never size.
  const handle = canvas.slice(canvas.indexOf("begin(e, w, \"resize\")"));
  assert.match(handle.slice(0, 900), /onKeyDown/, "the resize handle needs a keyboard path");
  assert.match(canvas, /<button\s+type="button"\s+onPointerDown={\(e\) => begin\(e, w, "resize"\)}/,
    "the handle must be a real button, not a span");
});

test("colour swatches announce what they are and whether they are chosen", () => {
  assert.match(inspector, /aria-pressed=\{w\.color === c\.hex\}/);
  assert.match(inspector, /aria-label=\{`Colour: \$\{c\.name\}`\}/,
    "a hex code is not a usable accessible name");
});

test("widget ids cannot collide", () => {
  // Date.now() alone collided on two duplicates in the same millisecond, and a
  // collision meant the inspector edited BOTH boxes and delete removed both.
  assert.match(modal, /function nextWidgetId/);
  assert.match(modal, /widgetSeq/);
  assert.doesNotMatch(modal, /id: `w\$\{Date\.now\(\)\.toString\(36\)\}`/);
});

test("hitting the widget limit says so", () => {
  assert.match(modal, /That is the limit of \$\{STAGE_MAX_WIDGETS\}/);
});

test("a deleted timer reads differently from one never chosen", () => {
  assert.match(modal, /that timer was deleted/);
});

test("the editor says when it is editing something that is on stage", () => {
  assert.match(modal, /screenIsLive/);
  assert.match(modal, /on stage now/);
});

test("renaming a screen does not write on every keystroke", () => {
  // 15 characters was 15 server actions and 30 fetches, each re-posting
  // OutputState to the projector and the stage screen.
  assert.match(panel, /function ScreenNameInput/);
  assert.match(panel, /onBlur=\{commit\}/);
  assert.doesNotMatch(panel, /onChange=\{\(e\) => api\.renameScreen/);
});

test("a paired stage screen gets the layout too", () => {
  // The cross-device (pair-code) subscriber folded thirteen fields and
  // silently dropped the stage LAYOUT, the timer wire and the scene — so a
  // church running its confidence monitor on an iPad or a second machine got
  // the legacy hardcoded screen no matter what the operator had designed, with
  // nothing anywhere to explain why. The feature simply did not exist for them.
  const page = readFileSync("src/app/stage/page.tsx", "utf8");
  const sub = page.slice(page.indexOf("realtime.subscribe((state)"), page.indexOf("if (firstMsg)"));
  for (const f of ["setStageLayout(state.stageLayout", "setStageLayoutList(state.stageLayouts", "foldTimersWire(state.timersWire", "setScene(state.scene"]) {
    assert.ok(sub.includes(f), `the pair-code path drops ${f.split("(")[0]} — a paired screen would not show it`);
  }
});

// ── the four pre-existing 🔴 the pessimist found, all fixed ────────────────

test("a Scene can still hide a layer once a layout is assigned", () => {
  // /stage early-returns into the layout renderer ABOVE every sceneHidesLayer
  // call on the route, so a Scene that hid the Timer layer went silently inert
  // the moment a layout was assigned — the operator turned timers off for that
  // screen and they came back, with nothing to explain it.
  const r = readFileSync("src/components/live/StageLayoutRenderer.tsx", "utf8");
  assert.match(r, /sceneHidesLayer\(scene, screen, "timer"\)/);
  // The WORDS. The first version of this masked `message` by "announcement"
  // instead — a rule the rest of the app does not have, on the wrong field
  // (operatorMessage is not announcement) — while leaving the slide layer
  // unmasked, so the built-in Pre-Service scene still put live lyrics on a
  // confidence monitor it had explicitly been told to keep them off.
  // The full kind-to-layer matrix lives in stage-layout-reaches-screen.test.ts.
  assert.match(r, /sceneHidesLayer\(scene, screen, "slide"\)/);
  const stage = readFileSync("src/app/stage/page.tsx", "utf8");
  assert.match(stage, /scene=\{scene\}/, "/stage must pass the scene to the layout renderer");
});

test("the renderer cannot be used without saying which screen it is on", () => {
  // Both the scene mask and per-timer routing are per-screen. A surface that
  // forgot to declare itself would silently ignore both, so the prop is
  // REQUIRED and the compiler enforces it.
  const r = readFileSync("src/components/live/StageLayoutRenderer.tsx", "utf8");
  assert.match(r, /\n  screen: SceneScreen;/, "screen must be a required prop, not optional");
});

test("per-timer screen routing applies to a timer inside a layout", () => {
  // timerShowsOn was only applied in TimerOverlayLayer, so a timer the
  // operator explicitly unticked for a screen still arrived there through a
  // layout widget — the setting meant nothing on that path.
  assert.match(readFileSync("src/components/live/StageLayoutRenderer.tsx", "utf8"),
    /timerShowsOn\(t\.screens, screen as TimerScreenId\)/);
});

test("voice never releases the stage layout", () => {
  // An ASR false positive must not wipe the band's and preacher's instrument
  // panel mid-sermon, with no feedback on the operator's own screen.
  const c = readFileSync("src/components/operator/OperatorConsole.tsx", "utf8");
  const vc = c.slice(c.indexOf("const voiceClear = useCallback("), c.indexOf("const voiceClear = useCallback(") + 200);
  assert.ok(!vc.includes("killOutput"), "voice clear must not route through killOutput");
});

test("clear-all releases the stage layouts", () => {
  // Escape, Blank and the hold-to-clear-all rail cleared slide, media, video
  // and announcement and did NOTHING to a stage layout — so the one thing
  // covering the entire confidence monitor was the one thing an operator could
  // not clear under pressure.
  const c = readFileSync("src/components/operator/OperatorConsole.tsx", "utf8");
  const kill = c.slice(c.indexOf("const killOutput"), c.indexOf("const voiceClear"));
  assert.match(kill, /setStageLayoutsCleared\(true\)/, "killOutput must release the layouts");
  assert.match(c, /!stageLayoutsCleared \? \{ stageLayout \}/, "and the published state must honour it");
  // The release must sit ABOVE the V3 early return. NEXT_PUBLIC_LAYER_ORDER_V3
  // is set in no Vercel environment, so a release below that return ran for
  // almost nobody — a panic button gated on an unset feature flag.
  const gate = kill.indexOf("if (!layerOrderV3On)");
  const rel = kill.indexOf("setStageLayoutsCleared(true)");
  assert.ok(rel > -1 && rel < gate,
    "the stage-layout release must run before the V3 early return, or it never fires");

  // The un-clear is driven by the assignment ACTION, never by the payload.
  // On the payload it could not hold (the payload re-emits every shell render)
  // and fixing that would latch the operator out, because re-tapping an
  // already-assigned design produces an identical payload and no event at all.
  assert.match(c, /presentflow:stage-layout-assigned/,
    "there must be an explicit assignment event to un-clear from");
  const hook = readFileSync("src/components/operator/pro/right/useStageLayouts.ts", "utf8");
  assert.ok((hook.match(/presentflow:stage-layout-assigned/g) ?? []).length >= 3,
    "assign() and both branches of use() must announce the assignment");
  const payloadListener = c.slice(c.indexOf("setStageLayoutList(d?.list"), c.indexOf("setStageLayoutList(d?.list") + 200);
  assert.doesNotMatch(payloadListener, /setStageLayoutsCleared\(false\)/,
    "the un-clear must not ride on the payload — it cannot hold and it can latch");
});

test("MultiView shows a stage layout as it really is", () => {
  // MultiView mirrored only the LEGACY stage screen, so the operator's single
  // "what is on my screens" dashboard was blind to the thing covering the
  // entire monitor. Worse than showing nothing: it confidently showed a
  // current/next split that was not on the screen at all.
  const mv = readFileSync("src/components/operator/pro/right/MultiView.tsx", "utf8");
  const resolver = readFileSync("src/lib/multiview.ts", "utf8");
  assert.match(resolver, /stageLayout\?: StageLayoutWire \| null;/, "the resolver must carry the layout");
  assert.match(resolver, /s\?\.stageLayouts\?\.\[0\]\?\.layout \?\? s\?\.stageLayout/,
    "and resolve it the same way /stage does");
  assert.match(mv, /<StageLayoutRenderer[\s\S]{0,200}layout=\{view\.stageLayout\}/,
    "the tile must render it");

  // A DASHBOARD THAT LIES IS WORSE THAN ONE THAT ADMITS IT CANNOT SHOW
  // SOMETHING. The first version of this tile passed scene={null} and no
  // timers, so it showed a timer the operator had switched off in a Scene — a
  // false positive on the one screen they would check to confirm it was off —
  // and every timer rendered as a dash.
  assert.match(mv, /scene=\{view\.stageScene \?\? null\}/,
    "the tile must hide exactly what the real screen hides");
  assert.match(mv, /wireTimers=\{view\.stageTimers \?\? \[\]\}/,
    "the tile must show real timer values, not the unbound dash");
  // THE WORDS. Without these the tile drew the frame, the background and the
  // timers and left current_text / next_text empty while the real monitor was
  // showing lyrics — confidently displaying something that is not on screen.
  for (const prop of ["currentText", "nextText", "message"]) {
    assert.match(mv, new RegExp(`${prop}=\\{view\\.stage`),
      `the tile passes no ${prop}, so those widgets render blank while the monitor shows text`);
  }
  // ONE slideText, shared. Two copies is how the dashboard and the monitor it
  // claims to mirror start disagreeing.
  const shared = readFileSync("src/lib/slide-text.ts", "utf8");
  assert.match(shared, /export function slideText/);
  assert.doesNotMatch(readFileSync("src/app/stage/page.tsx", "utf8"), /^function slideText\(/m,
    "/stage must import the shared slideText, not keep its own copy");
  assert.match(resolver, /stageScene: scene/, "the resolver must pass the active scene through");
  assert.match(resolver, /stageTimers: s\?\.timersWire\?\.timers/, "and the live timer anchors");

  // One tile, up to eight stage screens. Drawing the first without saying so
  // implies it is the only one.
  assert.match(resolver, /1 of \$\{s!\.stageLayouts!\.length\} stage screens/);

  assert.doesNotMatch(mv, /stage countdowns aren&apos;t shown here/,
    "the footnote must no longer claim layouts are invisible here");
  assert.doesNotMatch(mv, /drawn as it really is; elsewhere/,
    "the footnote claimed 'as it really is' while timers were dashed and scenes ignored");
});
