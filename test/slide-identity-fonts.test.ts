/**
 * Fonts P1 — fontStack is RENDER-TIME only: slideOutputIdentity strings for
 * font-bearing slides are byte-identical to the pre-registry values (fade-pulse
 * guard, CLAUDE.md rule 7), the sanitized payload keeps the stored family, and
 * the rendered markup gains the generic fallback.
 * Run: npx tsx test/slide-identity-fonts.test.ts
 */
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { slideOutputIdentity, sanitizeOutputState, EMPTY_OUTPUT, type SlidePayload, type SlideObjectWire } from "../src/lib/broadcast";

(globalThis as unknown as { React: typeof React }).React = React;

let pass = 0, fail = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name} — ${(e as Error).message}`); fail++; }
}
const txt = (fontFamily: string, extra: Partial<Extract<SlideObjectWire, { kind: "text" }>> = {}): SlideObjectWire =>
  ({ kind: "text", x: 100, y: 200, w: 1700, h: 600, text: "Amazing grace", fontFamily, fontSize: 96, fontWeight: 700, color: "#ffffff", align: "center", ...extra });

// Pinned literal identities (computed with origin/main broadcast.ts, which Fonts P1 does not touch).
const FIXTURES: { slide: SlidePayload; id: string }[] = [
  { slide: { kind: "text", text: "Amazing grace", objects: [txt("Sora")] }, id: "t:Amazing grace||||o1:t100,200,1700,600#ffffff,Sora,96,700,center,," },
  { slide: { kind: "text", text: "Amazing grace", objects: [txt("Playfair Display", { italic: true })] }, id: "t:Amazing grace||||o1:t100,200,1700,600#ffffff,Playfair Display,96,700,center,i," },
  { slide: { kind: "text", text: "Amazing grace", objects: [txt("Helvetica", { uppercase: true })] }, id: "t:Amazing grace||||o1:t100,200,1700,600#ffffff,Helvetica,96,700,center,,u" },
  { slide: { kind: "text", text: "For God so loved", reference: "John 3:16", objects: [txt("Inter"), txt("Courier New", { y: 900 })] }, id: "t:For God so loved|John 3:16|||o2:t100,200,1700,600#ffffff,Inter,96,700,center,,;t100,900,1700,600#ffffff,Courier New,96,700,center,," },
  { slide: { kind: "text", text: "Plain lyric" }, id: "t:Plain lyric|||" },
];

(async () => {
  const { SlideRenderer } = await import("../src/components/live/SlideRenderer");
  const html = (slide: SlidePayload) => renderToStaticMarkup(React.createElement(SlideRenderer, { slide, projectorFit: true }));

  for (const f of FIXTURES) {
    await check(`identity byte-identical: ${f.id.slice(0, 60)}`, () => assert.equal(slideOutputIdentity(f.slide), f.id));
  }
  await check("sanitized payload keeps the STORED family (no stack on the wire)", () => {
    const out = sanitizeOutputState({ ...EMPTY_OUTPUT, slide: FIXTURES[1].slide } as never) as { slide: SlidePayload } | null;
    const objs = (out?.slide as Extract<SlidePayload, { kind: "text" }>).objects!;
    assert.equal((objs[0] as { fontFamily?: string }).fontFamily, "Playfair Display");
  });
  await check("sole text object renders with generic fallback (render-time)", () => {
    const m = html(FIXTURES[0].slide);
    // Inter sits between Sora and the generic on purpose: Sora has no Yoruba/Igbo
    // glyphs, so those letters fall through PER GLYPH to a bundled face we
    // control instead of the OS font (Fonts P1 gate 🔴3).
    assert.match(m, /font-family:Sora, Inter, sans-serif/);
  });
  await check("multi-object layer renders with registry stack", () => {
    const m = html(FIXTURES[3].slide);
    assert.match(m, /font-family:Inter, sans-serif/);
    assert.match(m, /font-family:Courier New, monospace/);
  });
  await check("rendering does not mutate the slide object", () => {
    const s = JSON.parse(JSON.stringify(FIXTURES[2].slide));
    html(s);
    assert.deepEqual(s, FIXTURES[2].slide);
    assert.equal(slideOutputIdentity(s), FIXTURES[2].id);
  });
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
