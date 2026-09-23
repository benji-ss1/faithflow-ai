/**
 * Slide CARDS must never render un-themed while the live output is themed.
 *
 * Field bug 2026-09-22 (Victor): every centre-grid and stage-row card rendered
 * BLACK while the live preview showed the theme's gradient. The card text was
 * still themed because that is baked into objects_json — only the BACKGROUND
 * was missing, which is the signature of "the card got no appearance".
 *
 * Cause: the card path and the live path are two DIFFERENT resolutions.
 *   cards -> appearanceForItem(previewItemIdx) = resolveItemThemeConfig(...) ?? appearance
 *   live  -> liveAppearance (liveItemIdx + a retained-appearance fallback)
 * `resolveItemThemeConfig` yields null while `contentStyles` is still {} (it is
 * on first render by design) or before the themes cache lands, and the
 * `appearance` state is only set for a theme row flagged isDefault — and not at
 * all once an in-session theme apply sets `userTouched`. Both null => the card
 * received `undefined` and painted transparent over its opaque black base.
 *
 * Run: npx tsx test/card-appearance-fallback.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveItemThemeConfig } from "../src/lib/live-item-theme";
import { themeConfigToAppearance } from "../src/lib/theme-appearance";

let pass = 0, fail = 0;
const check = (n: string, fn: () => void) => { try { fn(); console.log(`  PASS  ${n}`); pass++; } catch (e) { console.error(`  FAIL  ${n}\n        ${(e as Error).message}`); fail++; } };
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const MODERN = { align: "center", bgType: "gradient", bgAngle: 135, bgColor: "#2b1055", bgColor2: "#7597de",
  textColor: "#ffffff", fontFamily: "Montserrat", fontSizePx: 76, fontWeight: 700 };

console.log("the null legs that produced the black cards:");
check("a song item with no themeId resolves to NULL while contentStyles is still {}", () => {
  const cfg = resolveItemThemeConfig({ type: "song" } as never, {}, () => MODERN);
  assert.equal(cfg, null, "test premise changed — this used to be the first null leg");
});
check("...and resolves once the content-type style has landed", () => {
  const cfg = resolveItemThemeConfig({ type: "song" } as never, { song: "theme-1" }, (id) => (id === "theme-1" ? MODERN : undefined));
  assert.ok(cfg, "content-type style no longer resolves");
});
check("an EMPTY themes cache is the second null leg", () => {
  const cfg = resolveItemThemeConfig({ type: "song", songAppliedThemeId: "theme-1" } as never, {}, () => undefined);
  assert.equal(cfg, null);
});
check("an item theme resolves when the cache has it", () => {
  const cfg = resolveItemThemeConfig({ type: "song", themeId: "theme-1" } as never, {}, (id) => (id === "theme-1" ? MODERN : undefined));
  assert.deepEqual(cfg, MODERN);
});

console.log("\nthe fix — a card can never be LESS themed than what we would project:");
check("appearanceForItem falls back to the church default theme BY ID", () => {
  const src = read("../src/components/operator/OperatorConsole.tsx");
  const i = src.indexOf("const appearanceForItem");
  const body = src.slice(i, i + 2200);
  assert.match(body, /defaultThemeIdRef\.current \? themesByIdRef\.current\.get\(defaultThemeIdRef\.current\) : undefined/,
    "the church-default-by-id fallback is gone — cards can be null again while the send path resolves a theme");
  assert.match(body, /return defCfg \? appearanceForConfig\(defCfg\) : null;/);
});
check("it matches the fallback the SEND path already uses", () => {
  const src = read("../src/components/operator/OperatorConsole.tsx");
  assert.match(src, /byId\(ct\) \?\? byId\(defaultThemeIdRef\.current\)/,
    "themeConfigForSend's default fallback changed — the card resolver now mirrors a rule that no longer exists");
});
check("the grid keeps a last-resort ctx.appearance belt", () => {
  const src = read("../src/components/operator/pro/center/SlideGrid.tsx");
  assert.match(src, /\(ctx\.appearanceForItem \? ctx\.appearanceForItem\(ctx\.previewItemIdx\) : null\) \?\? ctx\.appearance/,
    "SlideGrid lost its null belt — a null appearance paints every card black");
});
check("the projector resolver was deliberately NOT changed", () => {
  const src = read("../src/components/operator/OperatorConsole.tsx");
  const i = src.indexOf("const effectiveAppearance");
  const body = src.slice(i, i + 400);
  assert.ok(!/defaultThemeIdRef/.test(body),
    "effectiveAppearance now has the default fallback too — that CHANGES WHAT THE PROJECTOR EMITS and needs its own sign-off");
});
check("ctx re-packs when the card resolver's inputs change", () => {
  const src = read("../src/components/operator/OperatorConsole.tsx");
  const i = src.indexOf("  }), [\n    // Y6:");
  const deps = src.slice(i, i + 2400);
  for (const d of ["appearanceForItem", "appearance,", "contentStyles", "themesVersion"]) {
    assert.ok(deps.includes(d), `shellCtx deps lost ${d} — the grid can get a stale resolver closure`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
