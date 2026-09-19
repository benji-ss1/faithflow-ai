// Tests the pure theme-bake helper used by the per-slide theme override.
// Run: npx tsx test/theme-bake.test.ts
import assert from "node:assert";
import { bakeThemeIntoObjectsJson } from "../src/lib/theme-bake";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log("  PASS " + name); pass++; }
  catch (e) { console.error("  FAIL " + name + "\n    " + (e as Error).message); fail++; }
}
const textObj = (extra: Record<string, unknown> = {}) => ({ kind: "text", text: "Hi", ...extra });

check("bakes font + color + align onto text objects (solid bg)", () => {
  const out = bakeThemeIntoObjectsJson(
    { fontFamily: "Inter", fontSizePx: 72, fontWeight: 700, textColor: "#ffffff", align: "center", bgType: "solid", bgColor: "#222222" },
    { objects: [textObj({ fontFamily: "Arial", color: "#000000" })] },
  );
  const o = (out.objects as any[])[0];
  assert.equal(o.fontFamily, "Inter");
  assert.equal(o.fontSize, 72);
  assert.equal(o.fontWeight, 700);
  assert.equal(o.align, "center");
  assert.equal(o.color, "#ffffff"); // white on dark = readable, kept
  assert.equal(out.bgColor, "#222222");
});

check("non-text objects are untouched", () => {
  const img = { kind: "image", url: "x", fit: "cover" };
  const out = bakeThemeIntoObjectsJson({ fontFamily: "Inter" }, { objects: [img] });
  assert.deepEqual((out.objects as any[])[0], img);
});

check("pure-black bg baked as near-black sentinel #010101", () => {
  const out = bakeThemeIntoObjectsJson({ bgType: "solid", bgColor: "#000000" }, { objects: [] });
  assert.equal(out.bgColor, "#010101");
});

check("gradient theme does NOT bake a solid bgColor and CLEARS the slide's own (it would cover the gradient)", () => {
  const out = bakeThemeIntoObjectsJson(
    { bgType: "gradient", bgColor: "#ff0000", bgColor2: "#00ff00" },
    { bgColor: "#111111", bgColor2: "#222222", bgImageUrl: "https://x/old.png", objects: [] },
  );
  assert.equal(out.bgColor, undefined);
  assert.equal(out.bgColor2, undefined);
  assert.equal(out.bgImageUrl, undefined);
  assert.ok(!("bgColor" in out));
});

// Field bug 2026-09-19 (Victor): "apply a theme to a song" only restyled SOME
// slides. A slide's own bgColor / bgImageUrl outranks the theme at render time
// (SlideRenderer: bgImageUrl > bgColor > theme), so any slide still carrying an
// older background (an earlier solid/image theme, or an editor-saved colour) kept
// it. A theme that defines a background now owns the slide's whole bg stack.
check("solid theme clears a stale image left by an earlier theme", () => {
  const out = bakeThemeIntoObjectsJson({ bgType: "solid", bgColor: "#00aa44" }, { bgType: "image", bgImageUrl: "https://x/a.png", bgColor: "#123456", bgColor2: "#654321", objects: [] });
  assert.equal(out.bgColor, "#00aa44");
  assert.equal(out.bgType, "solid");
  assert.ok(!("bgImageUrl" in out) && !("bgColor2" in out));
});

check("image theme replaces the slide's image and drops a stale colour", () => {
  const out = bakeThemeIntoObjectsJson({ bgType: "image", bgImageUrl: "https://x/new.png" }, { bgColor: "#222222", bgImageUrl: "https://x/old.png", objects: [] });
  assert.equal(out.bgImageUrl, "https://x/new.png");
  assert.ok(!("bgColor" in out));
});

check("every slide of a song ends up with the same background whatever it carried before", () => {
  const before = [null, { objects: [] }, { bgColor: "#222222", objects: [] }, { bgColor: "#000000", objects: [textObj()] }, { bgImageUrl: "https://x/old.png", objects: [] }, { bgType: "solid", bgColor: "#00aa44", objects: [] }];
  for (const cfg of [{ bgType: "gradient", bgColor: "#111", bgColor2: "#999" }, { bgType: "solid", bgColor: "#336699" }, { bgType: "image", bgImageUrl: "https://x/i.png" }] as const) {
    const bgs = before.map((b) => { const o = bakeThemeIntoObjectsJson(cfg, b); return JSON.stringify([o.bgColor, o.bgColor2, o.bgImageUrl]); });
    assert.equal(new Set(bgs).size, 1, `${cfg.bgType}: ${bgs.join(" | ")}`);
  }
});

check("a theme with NO background fields leaves the slide's own background alone", () => {
  const out = bakeThemeIntoObjectsJson({ fontFamily: "Inter" }, { bgColor: "#222222", bgImageUrl: "https://x/old.png", objects: [] });
  assert.equal(out.bgColor, "#222222");
  assert.equal(out.bgImageUrl, "https://x/old.png");
});

check("contrast guard: light text on light bg flips to readable", () => {
  const out = bakeThemeIntoObjectsJson(
    { bgType: "solid", bgColor: "#ffffff", textColor: "#f0f0f0" },
    { objects: [textObj()] },
  );
  const o = (out.objects as any[])[0];
  assert.equal(o.color, "#111111"); // white-on-white → dark text
});

check("transition + bgImageUrl are baked through", () => {
  const out = bakeThemeIntoObjectsJson(
    { transition: { effectId: "fade_in", durationMs: 500, easing: "ease" }, bgImageUrl: "https://x/y.png" },
    { objects: [] },
  );
  assert.equal((out.transition as any).effectId, "fade_in");
  assert.equal(out.bgImageUrl, "https://x/y.png");
});

check("missing objectsJson → safe empty result", () => {
  const out = bakeThemeIntoObjectsJson({ fontFamily: "Inter" }, null);
  assert.deepEqual(out.objects, []);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
