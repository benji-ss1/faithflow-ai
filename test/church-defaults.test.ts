/**
 * Church defaults (2026-09-23) — pure logic.
 * Run: npx tsx test/church-defaults.test.ts
 */
import assert from "node:assert/strict";
import {
  normalizeChurchDefaultsInput, isValidDefaultBackgroundId, isTranslationAccessible,
  shouldSeedDefaultBackground, DEFAULT_BACKGROUND_CHOICES, applyChurchDefaults,
} from "../src/lib/church-defaults";
import { resolveActiveTheme, isThemeLiveNow, resolveMountTheme, getLiveThemeId, setLiveThemeId, LIVE_THEME_SESSION_KEY } from "../src/lib/live-theme";

// Minimal browser storage shims (backgroundStore + live-theme are client modules).
function memStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => (m.has(k) ? m.get(k)! : null), setItem: (k: string, v: string) => { m.set(k, String(v)); }, removeItem: (k: string) => { m.delete(k); }, clear: () => m.clear() };
}
const g = globalThis as Record<string, unknown>;
g.localStorage = memStorage(); g.sessionStorage = memStorage();
g.window ??= { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} };
g.CustomEvent ??= class { type: string; detail: unknown; constructor(t: string, i?: { detail?: unknown }) { this.type = t; this.detail = i?.detail; } };

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
  ok(DEFAULT_BACKGROUND_CHOICES.every((b) => typeof b.swatch === "string" && b.swatch.length > 0), "every choice has a representative swatch");
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
    backgroundReady: async () => true,
  };
  const r = await applyChurchDefaults("church-a", { translationId: U1, mainThemeId: U1, backgroundId: "gentleWaves" }, deps);
  ok(!r.ok && writes.length === 0, "any failed ownership check → zero writes");
  const r2 = await applyChurchDefaults("church-a", { backgroundId: "gentleWaves" }, { ...deps, writeBackground: async () => false });
  ok(!r2.ok, "unmigrated column surfaces a clear error");
  const r3 = await applyChurchDefaults("", { translationId: U1 }, deps);
  ok(!r3.ok, "no church → refused");

  // all-or-nothing: unmigrated background column → NOTHING written
  const w2: string[] = [];
  const okDeps = { ...deps, themeBelongs: async () => true, writeTranslation: async () => { w2.push("t"); }, writeMainTheme: async () => { w2.push("m"); }, writeBackground: async () => { w2.push("b"); return true; } };
  const r4 = await applyChurchDefaults("church-a", { translationId: U1, mainThemeId: U1, backgroundId: "gentleWaves" }, { ...okDeps, backgroundReady: async () => false });
  ok(!r4.ok && w2.length === 0, "background column missing → zero writes (no half-save)");
  const r5 = await applyChurchDefaults("church-a", { translationId: U1, mainThemeId: U1, backgroundId: "gentleWaves" }, { ...okDeps, writeBackground: async () => { w2.push("b"); return false; } });
  ok(!r5.ok && w2.join() === "b", "background write fails → translation/theme NOT written");
  w2.length = 0;
  const r6 = await applyChurchDefaults("church-a", { translationId: U1 }, { ...okDeps, backgroundReady: async () => false });
  ok(r6.ok && w2.join() === "t", "no background in the call → column state irrelevant");

  // 2026-09-24: writeAll (one DB transaction) is used when provided; its failure = nothing saved.
  const calls: unknown[] = [];
  const txDeps = { ...okDeps, writeAll: async (_c: string, v: unknown) => { calls.push(v); return true; } };
  w2.length = 0;
  const r7 = await applyChurchDefaults("church-a", { translationId: U1, mainThemeId: U1, backgroundId: "gentleWaves" }, txDeps);
  ok(r7.ok && calls.length === 1 && w2.length === 0, "writeAll: one atomic call, per-field writers unused");
  ok(JSON.stringify(calls[0]) === JSON.stringify({ backgroundId: "gentleWaves", translationId: U1, mainThemeId: U1 }), "writeAll receives every field");
  const r8 = await applyChurchDefaults("church-a", { translationId: U1 }, { ...txDeps, writeAll: async () => false });
  ok(!r8.ok, "writeAll failure → error (tx rolled back)");
  const r9 = await applyChurchDefaults("church-a", { backgroundId: "gentleWaves" }, { ...txDeps, backgroundReady: async () => false });
  ok(!r9.ok && calls.length === 1, "writeAll path still refuses when column missing, before writing");
  const r10 = await applyChurchDefaults("church-a", { mainThemeId: U1 }, { ...txDeps, themeBelongs: async () => false });
  ok(!r10.ok && calls.length === 1, "writeAll path still validates ownership first");

  // e2e #1: the seeded church default background SURVIVES the same mount's
  // theme-bg self-heal (main theme with a bgColor, no prior picks).
  const bs = await import("../src/backgrounds/store/backgroundStore");
  (g.localStorage as ReturnType<typeof memStorage>).clear();
  ok(bs.seedActiveBackgroundIfFresh("gentleWaves") === true, "fresh machine seeds");
  ok(bs.readActiveBackgroundId() === "gentleWaves", "seeded active");
  ok(bs.shouldKeepTemplateOverThemeBg() === true, "self-heal keeps the seeded default (it is stamped as a pick)");
  ok(bs.seedActiveBackgroundIfFresh("holyFire") === false, "never re-seeds over a stored pick");
  await new Promise((r) => setTimeout(r, 2));
  bs.markThemeBackgroundPicked();
  ok(bs.shouldKeepTemplateOverThemeBg() === false, "a later explicit theme-bg apply still wins");

  // mount theme: persisted live theme (same session) wins; else main.
  const T = [{ id: "a", isDefault: true }, { id: "b" }];
  ok(resolveMountTheme(T, null)?.id === "a", "fresh launch → main theme");
  ok(resolveMountTheme(T, "b")?.id === "b", "reload mid-session → the live theme stays");
  ok(resolveMountTheme(T, "gone")?.id === "a", "deleted live theme → main");
  ok(resolveMountTheme([{ id: "x" }], null) === null, "no main theme → nothing forced");
  setLiveThemeId("b");
  ok((g.sessionStorage as ReturnType<typeof memStorage>).getItem(LIVE_THEME_SESSION_KEY) === "b", "live id persisted per window session");
  ok(getLiveThemeId() === "b", "readable back");
  // pinned live id → starring another theme (isDefault moves) does not move "Live now"
  ok(isThemeLiveNow({ id: "b" }, [{ id: "a" }, { id: "b", isDefault: false }, { id: "c", isDefault: true }], getLiveThemeId()), "star elsewhere keeps Live now");
  setLiveThemeId(null);
  ok((g.sessionStorage as ReturnType<typeof memStorage>).getItem(LIVE_THEME_SESSION_KEY) === null, "cleared");

  console.log(`church-defaults: ${n} assertions passed`);
})().catch((e) => { console.error(e); process.exit(1); });
