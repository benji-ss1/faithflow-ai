// Decision B (2026-09-23): deliberate edits/applies lock a slide's style so it
// keeps its look; untouched/imported slides follow the default theme.
// Run: npx tsx test/style-lock.test.ts
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { lockStyledTextObjects, bakeThemeIntoObjectsJson } from "../src/lib/theme-bake";
import { isValidSlideObject } from "../src/lib/broadcast";
import { resetThemeOwnedFields } from "../src/lib/theme-rebake";
(globalThis as unknown as { React: typeof React }).React = React;
let pass = 0, fail = 0;
const check = (n: string, f: () => void) => { try { f(); console.log("  PASS " + n); pass++; } catch (e) { console.error("  FAIL " + n + "\n    " + (e as Error).message); fail++; } };
const t = (x: Record<string, unknown> = {}) => ({ id: "a", kind: "text", x: 0, y: 0, w: 1920, h: 1080, text: "Hi", color: "#ffd400", fontFamily: "Georgia", ...x });
(async () => {
  const { SlideRenderer } = await import("../src/components/live/SlideRenderer");
  const prev = { bgColor: "#000000", objects: [t()] };
  check("text-only edit does not lock", () => { const o = lockStyledTextObjects(prev, "#000000", [t({ text: "New" })]) as any[]; assert.equal(o[0].styleLocked, undefined); });
  check("untouched save does not lock", () => { const o = lockStyledTextObjects(prev, "#000000", [t()]) as any[]; assert.equal(o[0].styleLocked, undefined); });
  check("colour change locks", () => { const o = lockStyledTextObjects(prev, "#000000", [t({ color: "#ff0000" })]) as any[]; assert.equal(o[0].styleLocked, true); });
  check("font change locks", () => { const o = lockStyledTextObjects(prev, "#000000", [t({ fontFamily: "Inter" })]) as any[]; assert.equal(o[0].styleLocked, true); });
  check("bg colour change locks", () => { const o = lockStyledTextObjects(prev, "#223344", [t()]) as any[]; assert.equal(o[0].styleLocked, true); });
  check("existing lock is kept on a text-only edit", () => { const o = lockStyledTextObjects({ objects: [t({ styleLocked: true })] }, undefined, [t({ text: "x" })]) as any[]; assert.equal(o[0].styleLocked, true); });
  check("first recolour of a plain/imported lyric slide locks", () => { const o = lockStyledTextObjects(null, undefined, [{ id: "n", kind: "text", text: "x", fontFamily: "Inter", fontSize: 96, fontWeight: 600, color: "#ff0000", align: "center" }]) as any[]; assert.equal(o[0].styleLocked, true); });
  check("untouched plain/imported slide saved with editor defaults does not lock", () => { const o = lockStyledTextObjects(null, undefined, [{ id: "n", kind: "text", text: "x", fontFamily: "Inter", fontSize: 96, fontWeight: 600, color: "#FFFFFF", align: "center", italic: false }]) as any[]; assert.equal(o[0].styleLocked, undefined); });
  check("plain slide (no stored objects) + default black save does not lock", () => { const o = lockStyledTextObjects(null, "#000000", [{ id: "n", kind: "text", text: "x", fontFamily: "Inter", fontSize: 96, fontWeight: 600, color: "#ffffff", align: "center" }]) as any[]; assert.equal(o[0].styleLocked, undefined); });
  check("per-slide theme bake locks", () => { const o = bakeThemeIntoObjectsJson({ textColor: "#fff", bgColor: "#222222" }, { objects: [t()] }); assert.equal((o.objects as any[])[0].styleLocked, true); });
  check("wire validator accepts styleLocked, rejects non-boolean", () => { assert.equal(isValidSlideObject(t({ styleLocked: true })), true); assert.equal(isValidSlideObject(t({ styleLocked: "yes" })), false); });
  const theme = { bgType: "solid", bgColor: "#1e40af", textColor: "#ffffff" } as never;
  const slide = (obj: object) => ({ kind: "text", text: "Hi", bgColor: "#b91c1c", objects: [obj] }) as never;
  check("locked slide keeps its own look under the default theme", () => { const h = renderToStaticMarkup(React.createElement(SlideRenderer, { slide: slide(t({ styleLocked: true })), appearance: theme })); assert.match(h, /#b91c1c/i); assert.match(h, /#ffd400/i); });
  check("unlocked (imported) slide follows the default theme", () => { const h = renderToStaticMarkup(React.createElement(SlideRenderer, { slide: slide(t()), appearance: theme })); assert.match(h, /#1e40af/i); assert.doesNotMatch(h, /#ffd400/i); });
  check("revert theme removes the lock the apply added (exact restore)", () => {
    const orig = { bgColor: "#000000", objects: [t()] };
    const baked = bakeThemeIntoObjectsJson({ textColor: "#fff", bgColor: "#222222" }, orig);
    assert.equal((baked.objects as any[])[0].styleLocked, true);
    const r = resetThemeOwnedFields(baked, orig) as any;
    assert.equal("styleLocked" in r.objects[0], false);
  });
  check("revert keeps a lock that existed BEFORE the apply", () => {
    const orig = { bgColor: "#000000", objects: [t({ styleLocked: true })] };
    const baked = bakeThemeIntoObjectsJson({ textColor: "#fff", bgColor: "#222222" }, orig);
    const r = resetThemeOwnedFields(baked, orig) as any;
    assert.equal(r.objects[0].styleLocked, true);
  });
  // No-regression 🟡 (2026-09-23): over a Background Template (overVideo) a
  // theme-following song uses EXACTLY the Bible plain-text colour rule
  // (themeTextStyle: theme textColor, else auto-contrast vs theme bgColor).
  for (const th of [{ bgType: "solid", bgColor: "#f5f0e6" }, { bgType: "solid", bgColor: "#101010", textColor: "#ffe08a" }, { bgType: "solid", bgColor: "#1e40af" }]) {
    check(`song over template matches Bible plain text colour (${JSON.stringify(th)})`, () => {
      const colorOf = (h: string) => (h.match(/(?<![-\w])color:\s*(#[0-9a-f]{3,8}|rgb[^;"]+)/i) ?? [])[1]?.toLowerCase();
      const song = renderToStaticMarkup(React.createElement(SlideRenderer, { slide: { kind: "text", text: "Hi", objects: [t({ color: "#ffffff", fontFamily: "Inter" })] } as never, appearance: th as never, overVideo: true }));
      const bible = renderToStaticMarkup(React.createElement(SlideRenderer, { slide: { kind: "text", text: "Hi" } as never, appearance: th as never, overVideo: true }));
      assert.ok(colorOf(bible), "bible colour present");
      assert.equal(colorOf(song), colorOf(bible));
    });
  }
  console.log(`\nstyle-lock: ${pass} passed, ${fail} failed`); if (fail) process.exit(1);
})();
