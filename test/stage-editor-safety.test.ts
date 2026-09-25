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
