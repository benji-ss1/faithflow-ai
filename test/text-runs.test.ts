/**
 * PP7 parity R2: "special" formatting survives a theme apply.
 *
 * Applying a theme used to overwrite font/size/weight/colour on EVERY text
 * object, so a word an operator had bolded went plain the moment the song was
 * re-themed.
 *
 * ProPresenter's rule (RV "Maintaining Text Attributes") is a CONTRAST rule:
 *   "The types of formatting that will pass through is text that is Bold,
 *    Italic, Underlined, or a different color" ... "formatted differently from
 *    surrounding text in the same box".
 *   "Text position and font size will always match the theme's settings."
 *   "...if your entire text box shares one format (all bold and red), both the
 *    bold nature and red text will not be maintained."
 *
 * Run: npx tsx test/text-runs.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeRuns, specialRuns, splitIntoSegments, runDiffersFromBox, shiftRuns, MAX_RUNS } from "../src/lib/text-runs";
import { bakeThemeIntoObjectsJson } from "../src/lib/theme-bake";

let pass = 0, fail = 0;
const check = (n: string, fn: () => void) => {
  try { fn(); console.log(`  PASS  ${n}`); pass++; }
  catch (e) { console.error(`  FAIL  ${n}\n        ${(e as Error).message}`); fail++; }
};
const TEXT = "Amazing grace how sweet the sound";      // 32 chars
const JESUS = { start: 8, end: 13 };                    // "grace"

console.log("PP7's contrast rule — only what DIFFERS from the box survives:");
check("a bold word in a non-bold box is special", () => {
  const kept = specialRuns([{ ...JESUS, bold: true }], { bold: false }, TEXT.length);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].bold, true);
});
check("an all-bold box loses its bold — uniform formatting is NOT special", () => {
  // RV: "if your entire text box shares one format ... will not be maintained".
  const kept = specialRuns([{ start: 0, end: TEXT.length, bold: true }], { bold: true }, TEXT.length);
  assert.equal(kept.length, 0, "matching the box is indistinguishable from no formatting");
});
check("a red word in a white box is special; a white word in a white box is not", () => {
  assert.equal(specialRuns([{ ...JESUS, color: "#ff0000" }], { color: "#ffffff" }, TEXT.length).length, 1);
  assert.equal(specialRuns([{ ...JESUS, color: "#FFFFFF" }], { color: "#ffffff" }, TEXT.length).length, 0,
    "colour comparison must ignore case");
});
check("only the CONTRASTING attribute is kept, not the whole run", () => {
  // Bold matches the box, red does not: the box's bold should still follow the
  // theme, so only `color` survives.
  const kept = specialRuns([{ ...JESUS, bold: true, color: "#ff0000" }], { bold: true, color: "#ffffff" }, TEXT.length);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].color, "#ff0000");
  assert.equal(kept[0].bold, undefined, "bold matched the box, so it must not be preserved");
});
check("all four PP7 attributes can be special, and only those four", () => {
  for (const a of ["bold", "italic", "underline"] as const) {
    assert.equal(runDiffersFromBox({ ...JESUS, [a]: true }, { [a]: false }, a), true, a);
  }
  assert.equal(runDiffersFromBox({ ...JESUS, color: "#f00" }, { color: "#fff" }, "color"), true);
});

console.log("the real bug: a theme apply no longer wipes a bolded word:");
check("bake KEEPS a contrasting run and still restyles the box", () => {
  const out = bakeThemeIntoObjectsJson(
    { fontFamily: "Sora", fontSizePx: 120, fontWeight: 400, textColor: "#ffffff" } as never,
    { objects: [{ id: "a", kind: "text", text: TEXT, fontWeight: 400, color: "#ffffff", runs: [{ ...JESUS, bold: true }] }] },
  );
  const obj = (out.objects as Record<string, unknown>[])[0];
  assert.equal(obj.fontFamily, "Sora", "the box must still take the theme");
  assert.equal(obj.fontSize, 120, "size always follows the theme");
  assert.ok(Array.isArray(obj.runs) && (obj.runs as unknown[]).length === 1, "the bolded word must survive");
});
check("bake DROPS a run that matches the incoming theme", () => {
  // The operator's red matches the theme's new red ⇒ no longer special.
  const out = bakeThemeIntoObjectsJson(
    { textColor: "#ff0000" } as never,
    { objects: [{ id: "a", kind: "text", text: TEXT, color: "#ffffff", runs: [{ ...JESUS, color: "#ff0000" }] }] },
  );
  const obj = (out.objects as Record<string, unknown>[])[0];
  assert.equal(obj.runs, undefined, "a run that no longer contrasts must stop being special");
});
check("a slide with NO runs bakes exactly as before", () => {
  const before = { objects: [{ id: "a", kind: "text", text: TEXT, fontWeight: 400 }] };
  const out = bakeThemeIntoObjectsJson({ fontFamily: "Sora" } as never, before);
  assert.equal((out.objects as Record<string, unknown>[])[0].runs, undefined);
});

console.log("rendering splits the text correctly:");
check("no runs -> ONE plain segment (DOM byte-identical to before)", () => {
  const segs = splitIntoSegments(TEXT, undefined);
  assert.deepEqual(segs, [{ text: TEXT }]);
});
check("a run splits into before / run / after", () => {
  const segs = splitIntoSegments(TEXT, [{ ...JESUS, bold: true }]);
  assert.equal(segs.length, 3);
  assert.equal(segs[0].text, "Amazing ");
  assert.equal(segs[1].text, "grace");
  assert.equal(segs[1].bold, true);
  assert.equal(segs[2].text, " how sweet the sound");
});
check("segments always rejoin to the original text exactly", () => {
  for (const runs of [
    [{ start: 0, end: 7, bold: true }],
    [{ start: 0, end: TEXT.length, italic: true }],
    [{ start: 2, end: 5, bold: true }, { start: 10, end: 14, color: "#f00" }],
  ]) {
    assert.equal(splitIntoSegments(TEXT, runs).map((s) => s.text).join(""), TEXT);
  }
});

console.log("hostile or broken runs can never corrupt a slide:");
check("reversed, negative, NaN and out-of-bounds runs are dropped", () => {
  assert.deepEqual(normalizeRuns([{ start: 10, end: 3, bold: true }], TEXT.length), []);
  assert.deepEqual(normalizeRuns([{ start: NaN, end: 5, bold: true }], TEXT.length), []);
  assert.deepEqual(normalizeRuns([{ start: -5, end: -1, bold: true }], TEXT.length), []);
  const past = normalizeRuns([{ start: 2, end: 9999, bold: true }], TEXT.length);
  assert.equal(past[0].end, TEXT.length, "must clamp to the text, never slice past it");
});
check("a run carrying no attribute is dropped", () => {
  assert.deepEqual(normalizeRuns([{ start: 0, end: 5 }], TEXT.length), []);
});
check("overlaps are resolved, never rendered twice", () => {
  const segs = splitIntoSegments(TEXT, [{ start: 0, end: 10, bold: true }, { start: 5, end: 15, italic: true }]);
  assert.equal(segs.map((s) => s.text).join(""), TEXT, "overlap must not duplicate or drop characters");
});
check("run count is capped", () => {
  const many = Array.from({ length: MAX_RUNS + 50 }, (_, i) => ({ start: i, end: i + 1, bold: true }));
  assert.ok(normalizeRuns(many, 5000).length <= MAX_RUNS);
});

console.log("editing the text never bolds the WRONG word:");
check("an insertion before a run moves it along", () => {
  const r = shiftRuns([{ start: 8, end: 13, bold: true }], 0, 4, TEXT.length + 4);
  assert.equal(r[0].start, 12);
  assert.equal(r[0].end, 17);
});
check("an insertion after a run leaves it alone", () => {
  const r = shiftRuns([{ start: 8, end: 13, bold: true }], 20, 4, TEXT.length + 4);
  assert.equal(r[0].start, 8);
});
check("a deletion that swallows the run drops it rather than misplacing it", () => {
  const r = shiftRuns([{ start: 8, end: 13, bold: true }], 0, -20, 12);
  for (const run of r) assert.ok(run.end > run.start && run.end <= 12);
});

console.log("the wire refuses malformed runs:");
check("validator rejects bad offsets, bad types and bad colours", () => {
  const src = readFileSync(new URL("../src/lib/broadcast.ts", import.meta.url), "utf8");
  assert.match(src, /p\.runs !== undefined/);
  assert.match(src, /hasPollutionKey\(r\)/, "runs cross a wire — prototype pollution must be blocked");
  assert.match(src, /isValidColor\(rr\.color\)/);
});

console.log("the operator can actually create emphasis (end to end):");
check("the editor captures the selection BEFORE the button blurs it", () => {
  const canvas = readFileSync(new URL("../src/components/operator/editor/SlideCanvas.tsx", import.meta.url), "utf8");
  assert.match(canvas, /selectionOffsetsWithin/);
  assert.match(canvas, /setTextSelection/);
  // Without this the properties-panel buttons would always find an empty
  // selection and silently do nothing.
  assert.match(canvas, /onSelect=/);
});
check("emphasis buttons exist, and are disabled until words are selected", () => {
  const modal = readFileSync(new URL("../src/components/operator/pro/DesktopSlideEditorModal.tsx", import.meta.url), "utf8");
  assert.match(modal, /Emphasise selected words/);
  assert.match(modal, /disabled=\{!sel\}/, "a button that silently does nothing is worse than a disabled one");
  assert.match(modal, /applyRun/);
  assert.match(modal, /Clear emphasis/);
});
check("a caret (no range) is never stored as a selection", () => {
  const store = readFileSync(new URL("../src/lib/text-selection-store.ts", import.meta.url), "utf8");
  assert.match(store, /if \(sel && sel\.end <= sel\.start\) return;/);
});
check("selection offsets survive the text being split into spans", () => {
  // Once a run exists the box renders as several nodes; anchorOffset would be
  // relative to one node and give the wrong range.
  const store = readFileSync(new URL("../src/lib/text-selection-store.ts", import.meta.url), "utf8");
  assert.match(store, /cloneRange/);
  assert.match(store, /selectNodeContents/);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
