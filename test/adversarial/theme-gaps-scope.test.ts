/**
 * Theme gaps PR A — tenant scoping + capability gates of the new actions:
 * materializeBuiltinTheme, applyThemeToSongSlides, applyThemeToPlan.
 * Source assertions + pure-helper checks (no DB needed), same style as
 * theme-reapply-scope.test.ts.
 *
 * Run: npx tsx test/adversarial/theme-gaps-scope.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasCap } from "../../src/lib/session";
import { getBuiltinTheme, isBuiltinThemeId } from "../../src/lib/builtin-themes";
import { sanitizeThemeConfig } from "../../src/lib/theme-config";

const src = readFileSync("src/lib/actions.ts", "utf8");
function body(name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const next = src.indexOf("\nexport async function ", start + 10);
  return src.slice(start, next < 0 ? undefined : next);
}
let n = 0;
const ok = (cond: boolean | RegExpMatchArray | null, msg: string) => { assert.ok(cond, msg); n++; };

// ── materializeBuiltinTheme ──
{
  const b = body("materializeBuiltinTheme");
  ok(/hasCap\(user\.role, "operate_services"\)\) return \{ ok: false/.test(b), "materialize gates on operate_services without redirect");
  ok(/getBuiltinTheme\(builtinId\)/.test(b) && /if \(!builtin\) return \{ ok: false, error: "Unknown built-in theme" \}/.test(b), "unknown built-in id is refused");
  ok(/builtinThemeConfig\(builtin\.id\)/.test(b), "config comes from the server constant, not the client");
  ok(/db\.transaction\(/.test(b), "find-or-create runs in a transaction");
  ok(/pg_advisory_xact_lock\(hashtext\(\$\{"builtin-theme:" \+ user\.churchId/.test(b), "per-church advisory lock serialises concurrent materializes");
  ok(/eq\(themes\.churchId, user\.churchId\), sql`\$\{themes\.config\}->>'builtinId' = \$\{builtin\.id\}`/.test(b), "dedupe lookup is church-scoped (another church's copy never reused)");
  ok(/insert\(themes\)\.values\(\{ churchId: user\.churchId/.test(b), "created row belongs to the caller's church");
  ok(!isBuiltinThemeId("builtin:../../x") && getBuiltinTheme("constructor") === null && getBuiltinTheme(undefined) === null, "hostile ids resolve to nothing");
  ok(sanitizeThemeConfig({ builtinId: "builtin:nope" }, { allowBuiltinId: true }).rejected.includes("builtinId"), "unknown builtinId rejected even for materialize");
  ok(sanitizeThemeConfig({ builtinId: "builtin:dark" }).config.builtinId === undefined, "ANY builtinId is stripped via create/update/import");
}

// ── applyThemeToSongSlides ──
{
  const b = body("applyThemeToSongSlides");
  ok(/requireUser\(\);\s*if \(!hasCap\(user\.role, "edit_library"\)\) return \{ ok: false/.test(b), "batch apply: edit_library as {ok:false} (no redirect)");
  ok(/requireUser\(\);\s*if \(!hasCap\(user\.role, "edit_library"\)\) return \{ ok: false/.test(body("removeThemeFromSongSlides")), "batch remove: edit_library as {ok:false} (no redirect)");
  ok(/removeThemeFromSongSlides\(/.test(body("removeThemeFromSongSlide")), "single remove delegates to the gated batch");
  ok(/cleanSlideIds\(slideIds\)/.test(b) && /Invalid slide selection/.test(b), "slide ids validated (uuid, non-empty, capped)");
  ok(/eq\(themes\.id, themeId\), eq\(themes\.churchId, user\.churchId\)/.test(b), "theme church-scoped");
  ok(/eq\(songs\.id, songId\), eq\(songs\.churchId, user\.churchId\)\)\)\.for\("update"\)/.test(b), "song church-scoped + row-locked");
  ok(/slides\.length !== ids\.length\) return \{ ok: false, error: "Slide not found" \}/.test(b), "foreign/other-song slide ids reject the whole batch");
  ok(/if \(!\(slide\.id in backups\)\) backups\[slide\.id\] = \{ objectsJson: slide\.objectsJson \?\? null, themeId, bakedConfigs: \[pickBakedConfig\(cfg\)\] \}/.test(b), "first-snapshot backups tagged with themeId + server-side baked config");
  const helper = src.slice(src.indexOf("function cleanSlideIds("), src.indexOf("export async function applyThemeToSongSlides("));
  ok(/THEME_UUID_RE\.test\(id\)/.test(helper) && /MAX_BATCH_SLIDES/.test(helper), "helper rejects non-uuid ids and oversized batches");
}

// ── applyThemeToPlan ──
{
  const b = body("applyThemeToPlan");
  ok(/hasCap\(user\.role, "operate_services"\)\) return \{ ok: false/.test(b), "plan apply requires operate_services");
  ok(/includeSongs && !hasCap\(user\.role, "edit_library"\)\) return \{ ok: false/.test(b), "includeSongs additionally requires edit_library");
  ok(/eq\(servicePlans\.id, planId\), eq\(servicePlans\.churchId, user\.churchId\)/.test(b), "plan church-scoped");
  ok(/eq\(themes\.id, themeId\), eq\(themes\.churchId, user\.churchId\)/.test(b), "theme church-scoped (no cross-church theme id)");
  ok(/where\(eq\(serviceItems\.servicePlanId, planId\)\)/.test(b), "items read from the verified plan only");
  ok(/mergeServiceItemPayload\(tx, it\.id, planId, \{ themeId \}\)/.test(b), "single-key payload merge, plan-filtered");
  ok(/eq\(songs\.id, songId\), eq\(songs\.churchId, user\.churchId\)/.test(b), "song bake re-checks church");
  ok(!/presentflow:apply-theme-to-song/.test(b), "no apply-theme-to-song event (no double apply)");
  // Volunteer includeSongs denied, operator allowed.
  ok(hasCap("volunteer", "operate_services") && !hasCap("volunteer", "edit_library"), "volunteer: may apply to items, denied includeSongs");
  ok(!hasCap("viewer", "operate_services"), "viewer denied");
}

console.log(`theme-gaps-scope: all ${n} assertions passed`);
