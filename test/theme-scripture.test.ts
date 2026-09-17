/**
 * Theme → Projector (PR 2) — theme scripture options.
 *
 * Decision 4: a saved Scripture Style wins; theme options apply only without one
 * AND when the theme explicitly opts in (the legacy ThemesManager defaults —
 * show reference, "above", 56px — are NOT an opt-in). The theme path tags roles,
 * keeps `reference` ALWAYS (anti-replay depends on it), hides the reference
 * object when hidden/inline, and the renderer never duplicates the footer.
 *
 * Run: npx tsx test/theme-scripture.test.ts
 */
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { themeScriptureOptions, designFromThemeScripture } from "../src/lib/theme-scripture";
import {
  applyChurchLayout, styleScriptureSlide, themeScripturePayload, DEFAULT_SCRIPTURE_DESIGN, saveScriptureStyle,
} from "../src/components/operator/scripture/scriptureStyle";
import { slideOutputIdentity, slideDesignSig, sanitizeOutputState, isValidOutputState, EMPTY_OUTPUT, type SlidePayload } from "../src/lib/broadcast";
import { parseLiveScriptureRef, liveGuardText, resolvedDetectionAction } from "../src/lib/bible-antireplay";

(globalThis as unknown as { React: typeof React }).React = React;

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message.slice(0, 400)}`); fail++; }
}
const CH = "church-ts";
const VERSE: Extract<SlidePayload, { kind: "text" }> = { kind: "text", text: "16 For God so loved the world", reference: "John 3:16 (KJV)" };
const texts = (s: SlidePayload) => (s.kind === "text" && s.objects ? s.objects.filter((o) => o.kind === "text") : []) as Array<{ text: string; role?: string; hidden?: boolean; y: number; fontSize?: number }>;

async function main() {
  const { SlideRenderer } = await import("../src/components/live/SlideRenderer");
  const html = (slide: SlidePayload, props: Record<string, unknown> = {}) => renderToStaticMarkup(React.createElement(SlideRenderer, { slide, projectorFit: true, ...props }));

  console.log("Opt-in rules:");
  check("no config / legacy ThemesManager defaults → null (no opt-in)", () => {
    assert.equal(themeScriptureOptions(null), null);
    assert.equal(themeScriptureOptions({}), null);
    assert.equal(themeScriptureOptions({ scriptureShowReference: true, scriptureReferencePosition: "above", scriptureTranslationVisible: true, fontSizeScripturePx: 56 }), null);
    assert.equal(themeScriptureOptions({ fontSizeScripturePx: 72 }), null, "size alone is not an opt-in");
  });
  check("explicit off / below / inline / scripture layout slide → opt-in", () => {
    assert.equal(themeScriptureOptions({ scriptureShowReference: false })?.showReference, false);
    assert.equal(themeScriptureOptions({ scriptureTranslationVisible: false })?.showTranslation, false);
    assert.equal(themeScriptureOptions({ scriptureReferencePosition: "below" })?.position, "below");
    assert.equal(themeScriptureOptions({ scriptureReferencePosition: "inline" })?.position, "inline");
    const o = themeScriptureOptions({ fontSizeScripturePx: 70, layout: { version: 3, slides: [{ id: "s", role: "scripture", objects: [{ id: "v", kind: "text", text: "", x: 100, y: 100, w: 1700, h: 600, role: "verse", fontSize: 80 }] }] } });
    assert.ok(o?.verse);
    assert.equal(o?.fontSizePx, 70);
    assert.equal(o?.position, "above");
  });

  console.log("Parity — no theme options:");
  check("styleScriptureSlide/applyChurchLayout with null/undefined opts == legacy", () => {
    const norm = (s: SlidePayload) => JSON.stringify(s, (k, v) => (k === "id" ? "ID" : v));
    const legacy = norm(styleScriptureSlide(VERSE, CH));
    assert.equal(norm(styleScriptureSlide(VERSE, CH, null)), legacy);
    assert.equal(norm(applyChurchLayout(VERSE, CH, undefined)), legacy);
    assert.equal(slideOutputIdentity(applyChurchLayout(VERSE, CH, null)), slideOutputIdentity(styleScriptureSlide(VERSE, CH)));
  });
  check("songs / media / already-styled pass through untouched even with theme opts", () => {
    const opts = themeScriptureOptions({ scriptureShowReference: false })!;
    const song: SlidePayload = { kind: "text", text: "Amazing grace" };
    assert.equal(applyChurchLayout(song, CH, opts), song);
    const styled = styleScriptureSlide(VERSE, CH);
    assert.equal(styleScriptureSlide(styled, CH, opts), styled);
  });

  console.log("Theme scripture payloads:");
  check("below: verse + visible reference, roles tagged, reference field kept", () => {
    const s = applyChurchLayout(VERSE, CH, themeScriptureOptions({ scriptureReferencePosition: "below" }));
    const t = texts(s);
    assert.deepEqual(t.map((o) => [o.role, !!o.hidden]), [["verse", false], ["reference", false]]);
    assert.equal(s.kind === "text" && s.reference, "John 3:16 (KJV)");
    assert.ok(t[1].y > t[0].y, "reference below the verse");
  });
  check("above (opted in via translation off): reference at top, translation stripped", () => {
    const s = applyChurchLayout(VERSE, CH, themeScriptureOptions({ scriptureTranslationVisible: false }));
    const t = texts(s);
    assert.ok(t[1].y < t[0].y, "reference above");
    assert.equal(t[1].text, "John 3:16");
    assert.equal(s.kind === "text" && s.reference, "John 3:16");
  });
  check("translation hidden still parses for anti-replay (already-live no-op holds)", () => {
    const s = applyChurchLayout(VERSE, CH, themeScriptureOptions({ scriptureTranslationVisible: false }));
    assert.deepEqual(parseLiveScriptureRef(liveGuardText(s)), { book: "john", chapter: 3, verseStart: 16, verseEnd: 16 });
    assert.deepEqual(resolvedDetectionAction(s, { book: "John", chapter: 3, verseStart: 16, verseEnd: 16 }), { send: false, syncPreview: false });
  });
  check("hidden reference: object kept but hidden, reference field ALWAYS kept, parses", () => {
    const s = applyChurchLayout(VERSE, CH, themeScriptureOptions({ scriptureShowReference: false }));
    const t = texts(s);
    assert.equal(t[1].role, "reference");
    assert.equal(t[1].hidden, true);
    assert.equal(s.kind === "text" && s.reference, "John 3:16 (KJV)");
    assert.ok(parseLiveScriptureRef(liveGuardText(s)));
    const out = html(s);
    assert.ok(!out.includes("John 3:16"), "hidden reference must not render (no footer)");
  });
  check("inline: reference appended to verse, reference object hidden, no duplicate footer", () => {
    const s = applyChurchLayout(VERSE, CH, themeScriptureOptions({ scriptureReferencePosition: "inline" }));
    const t = texts(s);
    assert.equal(t[0].text, "16 For God so loved the world — John 3:16 (KJV)");
    assert.equal(t[1].hidden, true);
    assert.equal(s.kind === "text" && s.text, "16 For God so loved the world", "slide.text stays the raw verse");
    assert.equal(html(s).split("John 3:16").length - 1, 1, "reference shown exactly once");
  });
  check("visible reference renders exactly once (role-reference dedupes the footer)", () => {
    const s = applyChurchLayout(VERSE, CH, themeScriptureOptions({ scriptureReferencePosition: "below" }));
    const out = html(s);
    assert.equal(out.split("John 3:16 (KJV)").length - 1, 1);
    assert.equal(out.split("data-theme-frame").length - 1, 2, "verse + reference auto-fit boxes");
  });
  check("layout verse box geometry + size used", () => {
    const opts = themeScriptureOptions({ layout: { version: 3, slides: [{ id: "s", role: "scripture", objects: [
      { id: "v", kind: "text", text: "", x: 120, y: 200, w: 1600, h: 500, role: "verse", fontSize: 88 },
      { id: "r", kind: "text", text: "", x: 120, y: 750, w: 1600, h: 90, role: "reference" },
    ] }] } })!;
    const d = designFromThemeScripture(opts, DEFAULT_SCRIPTURE_DESIGN);
    assert.deepEqual([d.verse.x, d.verse.y, d.verse.w, d.verse.h, d.verse.fontSize], [120, 200, 1600, 500, 88]);
    assert.deepEqual([d.reference.y, d.reference.h], [750, 90]);
    assert.equal(d.layout, "fullscreen");
  });
  check("fontSizeScripturePx used when there is no verse box", () => {
    const d = designFromThemeScripture(themeScriptureOptions({ scriptureReferencePosition: "below", fontSizeScripturePx: 70 })!, DEFAULT_SCRIPTURE_DESIGN);
    assert.equal(d.verse.fontSize, 70);
  });
  check("identity deterministic across sends (random object ids excluded)", () => {
    const o = themeScriptureOptions({ scriptureShowReference: false });
    assert.equal(slideOutputIdentity(applyChurchLayout(VERSE, CH, o)), slideOutputIdentity(applyChurchLayout(VERSE, CH, o)));
  });

  console.log("Wire + identity:");
  check("slideDesignSig appends 'h' ONLY for hidden objects", () => {
    const vis = themeScripturePayload("v", "John 1:1", undefined, themeScriptureOptions({ scriptureReferencePosition: "below" })!);
    const hid = themeScripturePayload("v", "John 1:1", undefined, themeScriptureOptions({ scriptureShowReference: false })!);
    if (vis.kind !== "text" || hid.kind !== "text") throw new Error("kind");
    assert.ok(!slideDesignSig(vis).includes("h"), slideDesignSig(vis));
    assert.equal(slideDesignSig(hid).split("h").length - 1, 1, slideDesignSig(hid));
    const legacy = styleScriptureSlide(VERSE, CH);
    if (legacy.kind !== "text") throw new Error("kind");
    assert.ok(!/\dh/.test(slideDesignSig(legacy)), "saved/default style signature unchanged");
  });
  check("wire sanitiser + strict validator keep role + hidden", () => {
    const s = applyChurchLayout(VERSE, CH, themeScriptureOptions({ scriptureShowReference: false }));
    const st = { ...EMPTY_OUTPUT, live: s };
    assert.ok(isValidOutputState(st));
    const out = sanitizeOutputState(st)!;
    assert.deepEqual(texts(out.live).map((o) => [o.role, !!o.hidden]), [["verse", false], ["reference", true]]);
  });

  console.log("Surfaces:");
  check("stage (ignoreThemeLayout) renders the theme verse FULL-SCREEN as plain scripture", () => {
    const s = applyChurchLayout(VERSE, CH, themeScriptureOptions({ scriptureReferencePosition: "below" }));
    const plain = html({ kind: "text", text: VERSE.text, reference: "John 3:16 (KJV)" });
    assert.equal(html(s, { ignoreThemeLayout: true }), plain);
    const hidden = applyChurchLayout(VERSE, CH, themeScriptureOptions({ scriptureShowReference: false }));
    assert.equal(html(hidden, { transparentBg: true }), html({ kind: "text", text: VERSE.text }, { transparentBg: true }));
  });

  console.log("Saved Scripture Style wins (decision 4):");
  check("with a saved style, theme options are ignored", () => {
    const store = new Map<string, string>();
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
      dispatchEvent: () => true,
    };
    (globalThis as unknown as { CustomEvent: unknown }).CustomEvent = class { constructor(public type: string) {} };
    try {
      saveScriptureStyle(CH, { ...DEFAULT_SCRIPTURE_DESIGN, verse: { ...DEFAULT_SCRIPTURE_DESIGN.verse, fontSize: 111 } });
      const s = applyChurchLayout(VERSE, CH, themeScriptureOptions({ scriptureShowReference: false }));
      const t = texts(s);
      assert.equal(t[0].fontSize, 111);
      assert.ok(t.every((o) => !o.role && !o.hidden), "saved style path: no roles, nothing hidden");
    } finally {
      delete (globalThis as unknown as { window?: unknown }).window;
    }
  });

  console.log(`\ntheme-scripture: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
main();
