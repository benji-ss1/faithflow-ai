// PR B: the server-safe sanitizeScriptureDesign must match the ORIGINAL client
// loadScriptureStyle sanitizer (band ranges identical; verse/reference merge
// identical for well-typed input). Property test vs a verbatim copy of the old
// implementation. Run: npx tsx test/scripture-design-sanitize.test.ts
import assert from "node:assert/strict";
import { sanitizeScriptureDesign, sanitizeBandStyle, BAND_DEFAULT, DEFAULT_SCRIPTURE_DESIGN, sanitizeContentTypeStyles, SCRIPTURE_DESIGN_MAX_BYTES, type ScriptureDesign } from "../src/lib/scripture-design";
import * as reexport from "../src/components/operator/scripture/scriptureStyle";

// ---- verbatim copy of the pre-PR-B client sanitizer ----
const clampNum = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
function oldBand(raw: unknown) {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const D = BAND_DEFAULT;
  const num = (v: unknown, lo: number, hi: number, def: number) => typeof v === "number" && Number.isFinite(v) ? clampNum(v, lo, hi) : def;
  const hex = (v: unknown, def: string) => typeof v === "string" && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v) ? v : def;
  return {
    mode: b.mode === "none" || b.mode === "solid" || b.mode === "gradient" ? b.mode : D.mode,
    color: hex(b.color, D.color), color2: hex(b.color2, D.color2),
    angle: num(b.angle, 0, 360, D.angle), opacity: num(b.opacity, 0, 1, D.opacity),
    position: b.position === "upper" || b.position === "mid" || b.position === "lower" ? b.position : D.position,
    offsetY: num(b.offsetY, -25, 25, D.offsetY), heightPct: num(b.heightPct, 10, 60, D.heightPct),
    // 2026-09-19 DELIBERATE extension of this golden (owner request — independent verse vs
    // reference sizing + width). fontScale's floor dropped 0.5 -> 0.3 so the verse can be
    // dialled down to the reference line's size; refScale/widthPct are new, and default to
    // exactly today's rendering (1 / 88), so an untouched church is unchanged. Everything
    // else in this file still locks the sanitizer to its original behaviour.
    fontScale: num(b.fontScale, 0.3, 2, D.fontScale),
    refScale: num(b.refScale, 0.5, 3, D.refScale), widthPct: num(b.widthPct, 50, 100, D.widthPct),
  };
}
function oldLoad(parsed: Partial<ScriptureDesign>): ScriptureDesign {
  return {
    layout: parsed.layout === "lowerThird" ? "lowerThird" : "fullscreen",
    verse: { ...DEFAULT_SCRIPTURE_DESIGN.verse, ...parsed.verse },
    reference: { ...DEFAULT_SCRIPTURE_DESIGN.reference, ...parsed.reference },
    band: oldBand(parsed.band),
  } as ScriptureDesign;
}

let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
const anyVal = () => pick<unknown>([NaN, Infinity, -1e9, 1e9, -30, 0, 0.3, 1.7, 45, 400, "red", "#abc", "#a1b2c3", "#12345678", "#zzz", null, true, undefined, {}, []]);

let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };

// 1. band: identical on arbitrary junk (5000 cases)
for (let i = 0; i < 5000; i++) {
  const raw = rnd() < 0.05 ? pick<unknown>([null, "x", 5, []]) : {
    mode: pick<unknown>(["none", "solid", "gradient", "weird", 1]), color: anyVal(), color2: anyVal(), angle: anyVal(), opacity: anyVal(),
    position: pick<unknown>(["upper", "mid", "lower", "side"]), offsetY: anyVal(), heightPct: anyVal(), fontScale: anyVal(),
    refScale: anyVal(), widthPct: anyVal(),
  };
  assert.deepEqual(sanitizeBandStyle(raw), oldBand(raw)); n++;
}
// 2. whole design: identical for well-typed verse/reference partials (3000 cases)
const numKeys = ["x", "y", "w", "h", "fontSize", "fontWeight", "strokeWidth", "lineHeight", "letterSpacing"] as const;
for (let i = 0; i < 3000; i++) {
  const text = () => {
    const t: Record<string, unknown> = {};
    for (const k of numKeys) if (rnd() < 0.5) t[k] = Math.round((rnd() * 4000 - 2000) * 100) / 100;
    if (rnd() < 0.5) t.fontFamily = pick(["Sora", "Inter", "Georgia"]);
    if (rnd() < 0.5) t.color = pick(["#fff", "#000000", "rgba(0,0,0,.5)"]);
    if (rnd() < 0.5) t.align = pick(["left", "center", "right"]);
    for (const k of ["italic", "uppercase", "shadow"]) if (rnd() < 0.5) t[k] = rnd() < 0.5;
    if (rnd() < 0.3) t.stroke = "#111111";
    return t;
  };
  const ref = text(); if (rnd() < 0.5) ref.show = rnd() < 0.5; if (rnd() < 0.5) ref.showTranslation = rnd() < 0.5;
  const parsed = { layout: pick<unknown>(["lowerThird", "fullscreen", "x", undefined]), verse: rnd() < 0.9 ? text() : undefined, reference: rnd() < 0.9 ? ref : undefined, band: rnd() < 0.8 ? { heightPct: anyVal(), opacity: anyVal(), color: anyVal() } : undefined } as Partial<ScriptureDesign>;
  assert.deepEqual(sanitizeScriptureDesign(parsed), oldLoad(parsed)); n++;
}
// 3. hardening beyond the old merge (documented deviation): junk types → defaults, unknown keys dropped
const hard = sanitizeScriptureDesign({ verse: { fontSize: "huge", x: null, evil: "<script>", align: "justify" } })!;
ok(hard.verse.fontSize === DEFAULT_SCRIPTURE_DESIGN.verse.fontSize, "string fontSize → default");
ok(hard.verse.x === DEFAULT_SCRIPTURE_DESIGN.verse.x, "null x → default");
ok(!("evil" in hard.verse), "unknown key dropped");
ok(hard.verse.align === "center", "bad align → default");
const css = sanitizeScriptureDesign({ verse: { stroke: "red;--x:url(evil)", fontFamily: "Sora; background:url(x)" }, reference: { stroke: "rgba(0,0,0,0.5)", fontFamily: "'Open Sans', sans-serif" } })!;
ok(css.verse.stroke === DEFAULT_SCRIPTURE_DESIGN.verse.stroke, "CSS-injection stroke → default");
ok(css.verse.fontFamily === DEFAULT_SCRIPTURE_DESIGN.verse.fontFamily, "CSS-injection fontFamily → default");
ok(css.reference.stroke === "rgba(0,0,0,0.5)" && css.reference.fontFamily === "'Open Sans', sans-serif", "valid colour/font kept");
ok(sanitizeScriptureDesign(null) === null && sanitizeScriptureDesign("x") === null && sanitizeScriptureDesign([]) === null, "non-object → null");
ok(SCRIPTURE_DESIGN_MAX_BYTES === 16 * 1024, "16KB cap");
// 4. content-type styles
const U = "11111111-2222-3333-4444-555555555555";
assert.deepEqual(sanitizeContentTypeStyles({ song: U, scripture: "not-a-uuid", announcement: U, __proto__x: U }), { song: U }); n++;
assert.deepEqual(sanitizeContentTypeStyles("x"), {}); n++;
// 5. client module re-exports the same functions (no divergent copy)
ok(reexport.sanitizeBandStyle === sanitizeBandStyle && reexport.DEFAULT_SCRIPTURE_DESIGN === DEFAULT_SCRIPTURE_DESIGN, "scriptureStyle re-exports scripture-design");

console.log(`scripture-design-sanitize: ${n} assertions passed`);
