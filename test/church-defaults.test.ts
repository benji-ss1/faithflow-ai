/**
 * Church defaults (2026-09-23) — pure logic.
 * Run: npx tsx test/church-defaults.test.ts
 */
import assert from "node:assert/strict";
import {
  normalizeChurchDefaultsInput, isValidDefaultBackgroundId, isTranslationAccessible,
  shouldSeedDefaultBackground, DEFAULT_BACKGROUND_CHOICES, applyChurchDefaults,
} from "../src/lib/church-defaults";
import { resolveActiveTheme, isThemeLiveNow } from "../src/lib/live-theme";

let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const U1 = "11111111-1111-4111-8111-111111111111";

(async () => {
  // input normalization
  ok(normalizeChurchDefaultsInput(null).ok === false, "null rejected");
  ok(normalizeChurchDefaultsInput({ translationId: "KJV" }).ok === false, "non-uuid translation rejected");
  ok(normalizeChurchDefaultsInput({ mainThemeId: "x" }).ok === false, "non-uuid theme rejected");
  ok(normalizeChurchDefaultsInput({ backgroundId: "javascript:alert(1)" }).ok === false, "unknown background rejected");
  ok(normalizeChurchDefaultsInput({ backgroundId: "stainedLight" }).ok === false, "retired background not selectable");
  const n1 = normalizeChurchDefaultsInput({ translationId: U1, backgroundId: "none", extra: "ignored" });
  ok(n1.ok && n1.value.translationId === U1 && n1.value.backgroundId === null && !("extra" in n1.value), "whitelisted + none→null");
  const n2 = normalizeChurchDefaultsInput({});
  ok(n2.ok && Object.keys(n2.value).length === 0, "empty input = no-op");

  // backgrounds
  ok(DEFAULT_BACKGROUND_CHOICES.length > 0 && !DEFAULT_BACKGROUND_CHOICES.some((b) => b.id === "none"), "choices exclude none");
  ok(isValidDefaultBackgroundId("gentleWaves") && !isValidDefaultBackgroundId("none"), "gentleWaves valid, none not");
  ok(shouldSeedDefaultBackground(null, "gentleWaves"), "fresh machine seeds");
  ok(!shouldSeedDefaultBackground("none", "gentleWaves"), "explicit 'none' is kept");
  ok(!shouldSeedDefaultBackground("holyFire", "gentleWaves"), "existing pick is kept");
  ok(!shouldSeedDefaultBackground(null, null), "no church default → no seed");

  // translations
  ok(isTranslationAccessible({ code: "KJV", licenseRequired: false }, new Set()), "public domain accessible");
  ok(!isTranslationAccessible({ code: "NIV", licenseRequired: true }, new Set()), "locked licensed not accessible");
  ok(isTranslationAccessible({ code: "niv", licenseRequired: true }, new Set(["NIV"])), "unlocked licensed accessible");
  ok(!isTranslationAccessible(undefined, new Set()), "unknown not accessible");

  // live vs main theme
  const themes = [{ id: "a", isDefault: true }, { id: "b" }, { id: "c" }];
  ok(resolveActiveTheme(themes, null)?.id === "a", "no live → main");
  ok(resolveActiveTheme(themes, "b")?.id === "b", "live wins for quick tweaks");
  ok(resolveActiveTheme(themes, "gone")?.id === "a", "deleted live → main");
  ok(resolveActiveTheme([{ id: "x" }], null)?.id === "x", "no main → first");
  ok(resolveActiveTheme([], "b") === null, "empty → null");
  ok(isThemeLiveNow(themes[0], themes, null) && !isThemeLiveNow(themes[1], themes, null), "before apply: main is live");
  ok(isThemeLiveNow(themes[1], themes, "b") && !isThemeLiveNow(themes[0], themes, "b"), "after apply: applied is live, main is not");

  // write ordering: validation BEFORE any write
  const writes: string[] = [];
  const deps = {
    translationAccessible: async () => true,
    themeBelongs: async () => false,
    writeTranslation: async () => { writes.push("t"); },
    writeMainTheme: async () => { writes.push("m"); },
    writeBackground: async () => { writes.push("b"); return true; },
  };
  const r = await applyChurchDefaults("church-a", { translationId: U1, mainThemeId: U1, backgroundId: "gentleWaves" }, deps);
  ok(!r.ok && writes.length === 0, "any failed ownership check → zero writes");
  const r2 = await applyChurchDefaults("church-a", { backgroundId: "gentleWaves" }, { ...deps, writeBackground: async () => false });
  ok(!r2.ok, "unmigrated column surfaces a clear error");
  const r3 = await applyChurchDefaults("", { translationId: U1 }, deps);
  ok(!r3.ok, "no church → refused");

  console.log(`church-defaults: ${n} assertions passed`);
})().catch((e) => { console.error(e); process.exit(1); });
