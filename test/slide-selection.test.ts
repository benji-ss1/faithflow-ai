// Slide grid multi-select rules + thumbnail video strip.
// Run: npx tsx test/slide-selection.test.ts
import assert from "node:assert/strict";
import { slideRange, nextSlideSelection, stripVideoDecor, consumeSelectionEscape } from "../src/lib/slide-selection";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log("  PASS " + name); pass++; }
  catch (e) { console.error("  FAIL " + name + "\n    " + (e as Error).message); fail++; }
}
const ids = ["a", "b", "c", "d", "e"];

check("range forward/backward inclusive", () => {
  assert.deepEqual(slideRange(ids, 1, 3), ["b", "c", "d"]);
  assert.deepEqual(slideRange(ids, 3, 1), ["b", "c", "d"]);
  assert.deepEqual(slideRange(ids, 2, 2), ["c"]);
});
check("range with invalid anchor starts at the click; invalid click empty", () => {
  assert.deepEqual(slideRange(ids, -1, 2), ["c"]);
  assert.deepEqual(slideRange(ids, 99, 4), ["e"]);
  assert.deepEqual(slideRange(ids, 0, 9), []);
  assert.deepEqual(slideRange([], 0, 0), []);
});
check("shift-click selects anchor..click", () => {
  assert.deepEqual(nextSlideSelection([], ids, 3, 0, { range: true }), ["a", "b", "c", "d"]);
});
check("cmd-click toggles and includes the anchor first time", () => {
  const s1 = nextSlideSelection([], ids, 3, 1, { toggle: true });
  assert.deepEqual(s1, ["b", "d"]);
  const s2 = nextSlideSelection(s1, ids, 4, 1, { toggle: true });
  assert.deepEqual(s2, ["b", "d", "e"]);
  assert.deepEqual(nextSlideSelection(s2, ids, 3, 1, { toggle: true }), ["b", "e"]);
});
check("cmd+shift adds range to existing selection; result in grid order, no dups", () => {
  assert.deepEqual(nextSlideSelection(["e"], ids, 2, 0, { range: true, toggle: true }), ["a", "b", "c", "e"]);
});
check("plain click clears", () => {
  assert.deepEqual(nextSlideSelection(["a", "b"], ids, 2, 0, {}), []);
});
check("stripVideoDecor removes video decor only", () => {
  const img = { kind: "image", x: 0, y: 0, w: 1, h: 1, url: "https://x/i.png" } as never;
  const vid = { kind: "video", x: 0, y: 0, w: 1, h: 1, url: "https://x/v.mp4" } as never;
  const a = { bgColor: "#000", layout: { lyrics: { decor: [img, vid] }, scripture: { decor: [vid] } } } as never;
  const out = stripVideoDecor(a)!;
  assert.deepEqual(out.layout!.lyrics!.decor, [img]);
  assert.deepEqual(out.layout!.scripture!.decor, []);
  const plain = { bgColor: "#111" } as never;
  assert.equal(stripVideoDecor(plain), plain);
  assert.equal(stripVideoDecor(null), undefined);
});

// 🔴 review fix: Esc with a selection must NOT reach the global kill-live hotkey.
function escRig(selectionCount: number) {
  const dom = new JSDOM("<!doctype html><body><div id=g tabindex=0></div></body>");
  const w = dom.window;
  let killed = 0, cleared = 0;
  // Global hotkeys (useOperatorHotkeys / OperatorConsole) listen in the bubble phase.
  w.addEventListener("keydown", (e: Event) => { if ((e as KeyboardEvent).key === "Escape") killed++; });
  w.addEventListener("keydown", (e: Event) => { consumeSelectionEscape(e as KeyboardEvent, selectionCount, w.document.activeElement as HTMLElement, () => { cleared++; }); }, true);
  const ev = new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  w.document.getElementById("g")!.dispatchEvent(ev);
  return { killed, cleared, prevented: ev.defaultPrevented };
}
check("Esc with a selection clears it and never fires kill-live", () => {
  assert.deepEqual(escRig(2), { killed: 0, cleared: 1, prevented: true });
});
check("Esc with NO selection is untouched: kill-live fires exactly as before", () => {
  assert.deepEqual(escRig(0), { killed: 1, cleared: 0, prevented: false });
});
check("Esc while typing in a field is not consumed", () => {
  let c = 0;
  const ev = { key: "Escape", preventDefault() { throw new Error("no"); }, stopImmediatePropagation() { throw new Error("no"); } };
  assert.equal(consumeSelectionEscape(ev, 3, { tagName: "INPUT" }, () => c++), false);
  assert.equal(c, 0);
});
check("SlideGrid registers the Esc handler in the capture phase", () => {
  const src = readFileSync(new URL("../src/components/operator/pro/center/SlideGrid.tsx", import.meta.url), "utf8");
  assert.ok(src.includes('window.addEventListener("keydown", onKey, true)'));
  assert.ok(src.includes("consumeSelectionEscape("));
});

console.log(`\nslide-selection: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
