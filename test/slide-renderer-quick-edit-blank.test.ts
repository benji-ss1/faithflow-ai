/**
 * Quick edit on a BLANK slide — SlideRenderer must render an editable node for a
 * single text object with empty text WHEN editable, and render byte-identically
 * to before when NOT editable (projector/stage/livestream untouched).
 *
 * Run: npx tsx test/slide-renderer-quick-edit-blank.test.ts
 */
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SlidePayload } from "../src/lib/broadcast";

(globalThis as unknown as { React: typeof React }).React = React;

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}

async function main() {
  const { SlideRenderer } = await import("../src/components/live/SlideRenderer");
  const html = (slide: SlidePayload, props: Record<string, unknown> = {}) =>
    renderToStaticMarkup(React.createElement(SlideRenderer, { slide, ...props }));

  const blankObj = { kind: "text", x: 80, y: 400, w: 1760, h: 280, text: "", fontFamily: "Playfair Display", color: "#ffd700", align: "center" };
  const blank = { kind: "text", text: "", objects: [blankObj] } as unknown as SlidePayload;
  const plainBlank = { kind: "text", text: "" } as SlidePayload;

  check("blank sole-text slide + editable → contentEditable node with slide font", () => {
    const out = html(blank, { editable: true }).replace(/contentEditable/g, "contenteditable");
    assert.ok(out.includes('contenteditable="plaintext-only"'), out);
    assert.ok(out.includes("Playfair Display"), "keeps the object's font");
    assert.ok(out.includes("min-height:1em"), "empty editable node has a caret target");
  });

  check("blank sole-text slide WITHOUT editable → no contentEditable (unchanged objects layer)", () => {
    const out = html(blank).replace(/contentEditable/g, "contenteditable");
    assert.ok(!out.includes("contenteditable"), out);
    assert.ok(!out.includes("min-height:1em"));
  });

  check("non-edit render of a blank slide is identical with editable=false vs omitted", () => {
    assert.equal(html(blank, { editable: false }), html(blank));
  });

  check("plain (object-less) blank slide + editable → contentEditable node", () => {
    const out = html(plainBlank, { editable: true }).replace(/contentEditable/g, "contenteditable");
    assert.ok(out.includes('contenteditable="plaintext-only"'), out);
  });

  check("filled sole-text slide non-edit render carries no edit-only styles", () => {
    const filled = { kind: "text", text: "Amazing grace", objects: [{ ...blankObj, text: "Amazing grace" }] } as unknown as SlidePayload;
    const out = html(filled).replace(/contentEditable/g, "contenteditable");
    assert.ok(out.includes("Amazing grace") && !out.includes("contenteditable") && !out.includes("min-height:1em"));
  });

  console.log(`\nSlideRenderer quick-edit blank: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
