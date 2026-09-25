/**
 * song-theme-parity — 2026-09-23 "the theme always wins" (user-directed).
 * A plain lyric slide (ONE text object) must render the ACTIVE theme's bg +
 * text colour + font exactly like a Bible (plain text) slide, even when the
 * song stored a baked bgColor (#010101) and a non-white object colour.
 * Run: npx tsx test/song-theme-parity.test.ts
 */
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
(globalThis as unknown as { React: typeof React }).React = React;
let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}
(async () => {
  const { SlideRenderer } = await import("../src/components/live/SlideRenderer");
  const theme = { bgType: "solid", bgColor: "#b3261e", textColor: "#ffd400", fontFamily: "Inter" } as never;
  const song = {
    kind: "text", text: "OPEN THE EYES", bgColor: "#010101",
    objects: [{ id: "t", kind: "text", x: 0, y: 0, w: 1920, h: 1080, text: "OPEN THE EYES", color: "#00ff00", fontFamily: "Georgia", fontSize: 96 }],
  } as never;
  const r = (slide: never, extra: object = {}) => renderToStaticMarkup(React.createElement(SlideRenderer, { slide, appearance: theme, ...extra }));
  check("theme bg beats baked #010101", () => { const h = r(song); assert.match(h, /#b3261e/i); assert.doesNotMatch(h, /#010101/i); });
  check("theme colour + font beat stored object style", () => { const h = r(song); assert.match(h, /#ffd400/i); assert.doesNotMatch(h, /#00ff00/i); assert.doesNotMatch(h, /Georgia/); });
  check("plain (object-less) slide keeps an operator-chosen colour", () => { const h = r({ kind: "text", text: "X", bgColor: "#123456" } as never); assert.match(h, /#123456/); });
  check("font-only theme does NOT black out a coloured one-textbox slide", () => {
    const h = renderToStaticMarkup(React.createElement(SlideRenderer, { slide: { ...(song as object), bgColor: "#6a1b9a" } as never, appearance: { fontFamily: "Inter" } as never }));
    assert.match(h, /#6a1b9a/i);
  });
  check("image theme: song drops stored yellow/Georgia like a Bible verse", () => {
    const h = renderToStaticMarkup(React.createElement(SlideRenderer, { slide: song, appearance: { bgType: "image", bgImageUrl: "https://x/bg.jpg" } as never }));
    assert.doesNotMatch(h, /#00ff00/i); assert.doesNotMatch(h, /Georgia/);
  });
  check("inline editing shows the stored style", () => {
    const h = renderToStaticMarkup(React.createElement(SlideRenderer, { slide: song, appearance: theme, editable: true }));
    assert.match(h, /#00ff00/i);
  });
  check("no theme → stored style unchanged", () => { const h = renderToStaticMarkup(React.createElement(SlideRenderer, { slide: song })); assert.match(h, /#00ff00/i); });
  check("image slide keeps its image", () => { const h = r({ ...(song as object), bgImageUrl: "https://x/a.png" } as never); assert.match(h, /a\.png/); });
  check("multi-object designed slide keeps its colours", () => {
    const d = { kind: "text", text: "", objects: [
      { id: "a", kind: "text", x: 0, y: 0, w: 900, h: 200, text: "A", color: "#00ff00", fontSize: 60 },
      { id: "b", kind: "text", x: 0, y: 500, w: 900, h: 200, text: "B", color: "#00ff00", fontSize: 60 }] } as never;
    assert.match(r(d), /#00ff00/i);
  });
  console.log(`\nsong-theme-parity: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
