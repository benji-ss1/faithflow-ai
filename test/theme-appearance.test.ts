/**
 * Themes Phase 1 — isValidThemeAppearance wire-contract validation.
 * The appearance travels the cross-device Realtime path, so a malformed or
 * hostile payload must be rejected before it reaches the renderer's CSS.
 *
 * Run: npx tsx test/theme-appearance.test.ts
 */
import assert from "node:assert";
import { isValidThemeAppearance, isValidOutputState, EMPTY_OUTPUT } from "../src/lib/broadcast";
import { themeConfigToAppearance } from "../src/lib/theme-appearance";

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

console.log(`\n=== theme-appearance: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
