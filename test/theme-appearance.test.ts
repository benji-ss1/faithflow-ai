/**
 * Themes Phase 1 — isValidThemeAppearance wire-contract validation.
 * The appearance travels the cross-device Realtime path, so a malformed or
 * hostile payload must be rejected before it reaches the renderer's CSS.
 *
 * Run: npx tsx test/theme-appearance.test.ts
 */
import assert from "node:assert";
import { isValidThemeAppearance, isValidOutputState, EMPTY_OUTPUT } from "../src/lib/broadcast";
import { themeConfigToAppearance, appearanceHasBackground } from "../src/lib/theme-appearance";
import { themedObjectTextColor, isDefaultObjectTextColor } from "../src/lib/slide-objects";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name} — ${(e as Error).message}`); fail++; }
}

check("null is valid (no active theme)", () => assert.strictEqual(isValidThemeAppearance(null), true));
check("empty object is valid (all optional)", () => assert.strictEqual(isValidThemeAppearance({}), true));

check("full valid appearance accepted", () => {
  assert.strictEqual(isValidThemeAppearance({
    bgType: "gradient", bgColor: "#001a33", bgColor2: "#00335c", bgAngle: 135,
    dim: 0.3, textColor: "#ffffff", fontFamily: "Inter, sans-serif",
    fontWeight: 700, textShadow: true, align: "center",
  }), true);
});

check("image bg with https url accepted", () => {
  assert.strictEqual(isValidThemeAppearance({ bgType: "image", bgImageUrl: "https://s3.example.com/bg.jpg", dim: 0.5 }), true);
});

// ── Rejections ──────────────────────────────────────────────────────────
check("rejects unknown bgType", () => assert.strictEqual(isValidThemeAppearance({ bgType: "hologram" }), false));
check("rejects non-color bgColor (CSS injection attempt)", () =>
  assert.strictEqual(isValidThemeAppearance({ bgColor: "red;} body{display:none" }), false));
check("rejects url() injection in textColor", () =>
  assert.strictEqual(isValidThemeAppearance({ textColor: "#fff;background:url(http://evil)" }), false));
check("rejects non-https/javascript bgImageUrl", () =>
  assert.strictEqual(isValidThemeAppearance({ bgType: "image", bgImageUrl: "javascript:alert(1)" }), false));
check("rejects fontFamily with CSS-breakout chars", () =>
  assert.strictEqual(isValidThemeAppearance({ fontFamily: "Inter;} *{color:red}" }), false));
check("rejects over-long fontFamily", () =>
  assert.strictEqual(isValidThemeAppearance({ fontFamily: "a".repeat(200) }), false));
check("rejects out-of-range fontWeight", () => {
  assert.strictEqual(isValidThemeAppearance({ fontWeight: 50 }), false);
  assert.strictEqual(isValidThemeAppearance({ fontWeight: 1000 }), false);
});
check("rejects dim out of 0..1", () => {
  assert.strictEqual(isValidThemeAppearance({ dim: 2 }), false);
  assert.strictEqual(isValidThemeAppearance({ dim: -0.1 }), false);
});
check("rejects bgAngle out of 0..360", () => assert.strictEqual(isValidThemeAppearance({ bgAngle: 400 }), false));
check("rejects unknown align", () => assert.strictEqual(isValidThemeAppearance({ align: "justify" }), false));
check("rejects non-boolean textShadow", () => assert.strictEqual(isValidThemeAppearance({ textShadow: "yes" }), false));
check("rejects prototype pollution", () =>
  assert.strictEqual(isValidThemeAppearance(JSON.parse('{"__proto__":{"x":1}}')), false));

// ── Phase 2: video background + logo overlay ────────────────────────────
check("video bg with https url accepted", () =>
  assert.strictEqual(isValidThemeAppearance({ bgType: "video", bgVideoUrl: "https://s3.example.com/bg.mp4", dim: 0.4 }), true));
check("full logo config accepted", () =>
  assert.strictEqual(isValidThemeAppearance({ logoUrl: "https://s3.example.com/logo.png", logoPosition: "bottom-right", logoSizePct: 14, logoOpacity: 0.85 }), true));
check("rejects non-https bgVideoUrl", () =>
  assert.strictEqual(isValidThemeAppearance({ bgType: "video", bgVideoUrl: "http://x/v.mp4" }), false));
check("rejects url() breakout in logoUrl", () =>
  assert.strictEqual(isValidThemeAppearance({ logoUrl: 'https://x/a")body{}' }), false));
check("rejects unknown logoPosition", () =>
  assert.strictEqual(isValidThemeAppearance({ logoUrl: "https://x/l.png", logoPosition: "floating" }), false));
check("rejects out-of-range logoSizePct / logoOpacity", () => {
  assert.strictEqual(isValidThemeAppearance({ logoSizePct: 90 }), false);
  assert.strictEqual(isValidThemeAppearance({ logoSizePct: 1 }), false);
  assert.strictEqual(isValidThemeAppearance({ logoOpacity: 2 }), false);
});
check("mapper: video + logo config → valid appearance", () => {
  const a = themeConfigToAppearance({ bgType: "video", bgVideoUrl: "https://x/v.mp4", logoUrl: "https://x/l.png", logoPosition: "top-left", logoSizePx: 240, logoOpacity: 0.9 });
  assert.ok(a && isValidThemeAppearance(a), "mapped appearance must validate");
  assert.strictEqual(a!.bgType, "video");
  assert.strictEqual(a!.logoPosition, "top-left");
  assert.ok(a!.logoSizePct! > 2 && a!.logoSizePct! < 50, "logoSizePct in range");
});
check("mapper: non-https video/logo urls dropped (never freeze projector)", () => {
  const a = themeConfigToAppearance({ bgType: "video", bgVideoUrl: "http://x/v.mp4", logoUrl: "http://x/l.png" });
  // video url dropped → bgType falls back to solid; logo dropped
  assert.ok(a === null || (a.bgType !== "video" && !a.logoUrl), JSON.stringify(a));
  if (a) assert.ok(isValidThemeAppearance(a));
});

// ── OutputState carries appearance across the wire ──────────────────────
check("OutputState with valid appearance passes isValidOutputState", () => {
  const st = { ...EMPTY_OUTPUT, appearance: { bgType: "solid" as const, bgColor: "#101010", textColor: "#ffcc00" } };
  assert.strictEqual(isValidOutputState(st), true);
});
check("OutputState with hostile appearance is rejected", () => {
  const st = { ...EMPTY_OUTPUT, appearance: { bgColor: "#000;} html{}" } as unknown as null };
  assert.strictEqual(isValidOutputState(st), false);
});
check("OutputState without appearance still valid (backward compat)", () => {
  const st = { ...EMPTY_OUTPUT };
  delete (st as Record<string, unknown>).appearance;
  assert.strictEqual(isValidOutputState(st), true);
});

// ── Invariant: mapper output ALWAYS passes the wire validator ───────────
// If this ever fails, a stored theme config could produce an appearance that
// the projector rejects → the whole OutputState (incl. plain slide advances)
// is dropped → live output freezes. Keep the two rule sets in lockstep.
check("themeConfigToAppearance output always passes isValidThemeAppearance", () => {
  const configs: unknown[] = [
    null, {}, "not an object", 42,
    { bgType: "solid", bgColor: "#001a33", textColor: "#ffcc00", fontFamily: "Inter, sans-serif", fontWeight: 700, align: "center", textShadow: true },
    { bgType: "gradient", bgColor: "#001a33", bgColor2: "#00335c", bgAngle: 135, dim: 0.3 },
    { bgType: "image", bgImageUrl: "https://s3.example.com/church/bg.jpg?X-Amz-Signature=abc" },
    { bgType: "image", bgImageUrl: "https://" },                       // unparseable-ish
    { bgType: "image", bgImageUrl: "http://insecure/bg.jpg" },          // non-https
    { bgType: "image", bgImageUrl: 'https://x/a")body{}' },             // breakout attempt
    { bgType: "image", bgImageUrl: "https://my bucket.s3/x.png" },      // space
    { bgType: "video", bgVideoUrl: "https://x/v.mp4", bgColor: "#111" },
    { bgColor: "red;}body{}", textColor: "#fff" },                      // hostile color
    { fontFamily: "Inter;}*{}", textColor: "#fff" },                    // hostile font
    { fontWeight: 5000, bgAngle: 9999, dim: 42, bgColor: "#222" },      // out-of-range
    { align: "justify", textShadow: "yes", bgColor: "#222" },          // bad enums
  ];
  for (const cfg of configs) {
    const a = themeConfigToAppearance(cfg);
    assert.ok(a === null || isValidThemeAppearance(a), `config ${JSON.stringify(cfg)} → ${JSON.stringify(a)} must pass validator`);
  }
});

check("bgAnimation: valid presets accepted on the wire", () => {
  for (const m of ["none", "drift", "aurora", "pulse"]) {
    assert.strictEqual(isValidThemeAppearance({ bgColor: "#111", bgAnimation: m }), true, `${m} valid`);
  }
});
check("bgAnimation: rejects unknown preset", () =>
  assert.strictEqual(isValidThemeAppearance({ bgColor: "#111", bgAnimation: "explode" }), false));
check("bgAnimation: mapper carries drift on a gradient theme", () => {
  const a = themeConfigToAppearance({ bgType: "gradient", bgColor: "#001a33", bgColor2: "#00335c", bgAnimation: "drift" });
  assert.ok(a, "should build a theme");
  assert.strictEqual(a!.bgAnimation, "drift");
  assert.strictEqual(isValidThemeAppearance(a), true);
});
check("bgAnimation: mapper drops animation for image/video backgrounds", () => {
  const img = themeConfigToAppearance({ bgType: "image", bgImageUrl: "https://s3.example.com/bg.jpg", bgAnimation: "aurora" });
  assert.strictEqual(img?.bgAnimation, undefined, "no animation on image bg");
  const vid = themeConfigToAppearance({ bgType: "video", bgVideoUrl: "https://s3.example.com/v.mp4", bgAnimation: "pulse" });
  assert.strictEqual(vid?.bgAnimation, undefined, "no animation on video bg");
});
check("bgAnimation: a solid theme with only motion still counts as a theme", () => {
  const a = themeConfigToAppearance({ bgType: "solid", bgAnimation: "pulse" });
  assert.ok(a, "animation alone is meaningful");
  assert.strictEqual(a!.bgAnimation, "pulse");
});

// appearanceHasBackground — the trigger that clears a Background Template when a
// background-bearing theme is applied (mutually-exclusive backgrounds, 2026-08-28).
check("hasBackground: null / undefined → false", () => {
  assert.strictEqual(appearanceHasBackground(null), false);
  assert.strictEqual(appearanceHasBackground(undefined), false);
});
check("hasBackground: text-only theme (no bg) → false (can coexist with a template)", () => {
  assert.strictEqual(appearanceHasBackground({ textColor: "#fff", fontFamily: "Inter", fontWeight: 700 }), false);
  // bgType defaults to "solid" for text-only themes — solid ALONE must not count.
  assert.strictEqual(appearanceHasBackground({ bgType: "solid" }), false);
});
check("hasBackground: solid WITH a colour → true", () =>
  assert.strictEqual(appearanceHasBackground({ bgType: "solid", bgColor: "#0b1020" }), true));
check("hasBackground: gradient → true", () =>
  assert.strictEqual(appearanceHasBackground({ bgType: "gradient" }), true));
check("hasBackground: image with url → true; image without url → false", () => {
  assert.strictEqual(appearanceHasBackground({ bgType: "image", bgImageUrl: "https://s3.example.com/bg.jpg" }), true);
  assert.strictEqual(appearanceHasBackground({ bgType: "image" }), false);
});
check("hasBackground: video with url → true; video without url → false", () => {
  assert.strictEqual(appearanceHasBackground({ bgType: "video", bgVideoUrl: "https://s3.example.com/v.mp4" }), true);
  assert.strictEqual(appearanceHasBackground({ bgType: "video" }), false);
});
check("hasBackground: mapper output for a real bg theme → true", () => {
  const a = themeConfigToAppearance({ bgType: "gradient", bgColor: "#001a33", bgColor2: "#00335c" });
  assert.strictEqual(appearanceHasBackground(a), true);
});

// themedObjectTextColor — the fix that makes a Theme's textColor reach verse/
// song text objects (whose default fill is white) without overriding a colour
// the operator explicitly chose. (2026-08-28)
check("objText: default white inherits the theme colour when theme bg is showing", () => {
  assert.strictEqual(themedObjectTextColor("#ffffff", "#ffd700"), "#ffd700");
  assert.strictEqual(themedObjectTextColor("#FFF", "#ffd700"), "#ffd700");
  assert.strictEqual(themedObjectTextColor("white", "#ffd700"), "#ffd700");
  assert.strictEqual(themedObjectTextColor(undefined, "#ffd700"), "#ffd700");
});
check("objText: an explicit (non-white) colour always wins over the theme", () => {
  assert.strictEqual(themedObjectTextColor("#ff0000", "#ffd700"), "#ff0000");
  assert.strictEqual(themedObjectTextColor("#0a1b2c", "#ffd700"), "#0a1b2c");
});
check("objText: no theme colour (not themeBgShowing) → keep the object colour / white", () => {
  assert.strictEqual(themedObjectTextColor("#ffffff", undefined), "#ffffff");
  assert.strictEqual(themedObjectTextColor("#ff0000", undefined), "#ff0000");
  assert.strictEqual(themedObjectTextColor(undefined, undefined), "#ffffff");
});
check("objText: isDefaultObjectTextColor recognises the white defaults only", () => {
  for (const w of ["#ffffff", "#fff", "WHITE", "  #FFFFFF  ", "rgb(255,255,255)", undefined, null])
    assert.strictEqual(isDefaultObjectTextColor(w as string), true, `${w} is default`);
  for (const c of ["#000000", "#ff0000", "#fffffe", "rgb(0,0,0)"])
    assert.strictEqual(isDefaultObjectTextColor(c), false, `${c} is explicit`);
});

console.log(`\n=== theme-appearance: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
