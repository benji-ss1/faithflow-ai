/**
 * Operator-only chrome (update prompt, offline banner, toasts) must NEVER appear on the
 * congregation-facing pages — the projector, stage monitor, livestream overlay and NDI feed.
 * 2026-09-19: "A new version of PresentFlow is available — Reload now" showed on the live
 * projector because UpdatePrompt was mounted in the root layout.
 * Run: npx tsx test/output-surfaces.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isOutputSurfacePath, OUTPUT_SURFACE_PATHS } from "../src/lib/output-surfaces";

let pass = 0, fail = 0;
const check = (n: string, fn: () => void) => { try { fn(); console.log(`  PASS  ${n}`); pass++; } catch (e) { console.error(`  FAIL  ${n}\n        ${(e as Error).message}`); fail++; } };
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

console.log("which pages count as output:");
for (const p of ["/live", "/stage", "/livestream", "/ndi", "/live/", "/live?pair=ABC123", "/stage/", "/ndi?x=1#y", "/livestream?bg=transparent"]) {
  check(`${p} is an output page`, () => assert.equal(isOutputSurfacePath(p), true));
}
for (const p of ["/operator", "/dashboard", "/settings/outputs", "/services/abc/operate", "/liveliness", "/stages", "/", "/login", "/library/themes", "/setup/projector", "", null, undefined]) {
  check(`${String(p)} is NOT an output page`, () => assert.equal(isOutputSurfacePath(p as string), false));
}
check("/live does not accidentally swallow /livestream's rule (both listed explicitly)", () => {
  assert.ok(OUTPUT_SURFACE_PATHS.includes("/live") && OUTPUT_SURFACE_PATHS.includes("/livestream"));
});
check("every output route folder that exists is covered", () => {
  for (const dir of ["live", "stage", "livestream", "ndi"]) assert.ok(OUTPUT_SURFACE_PATHS.includes(`/${dir}` as never), dir);
});

console.log("root layout:");
const layout = read("src/app/layout.tsx");
const outside = layout.replace(/<OperatorChrome>[\s\S]*?<\/OperatorChrome>/g, "");
check("UpdatePrompt, OfflineIndicator and the Toaster are inside <OperatorChrome>", () => {
  for (const tag of ["<UpdatePrompt", "<OfflineIndicator", "<Toaster"]) {
    assert.ok(layout.includes(tag), `${tag} still mounted`);
    assert.ok(!outside.includes(tag), `${tag} is mounted OUTSIDE <OperatorChrome> — it would show on the projector`);
  }
});
check("OutputReloadListener stays unwrapped (the projector must still reload itself on a deploy)", () => {
  assert.ok(outside.includes("<OutputReloadListener"));
});
check("OperatorChrome renders nothing on an output page", () => {
  const src = read("src/components/system/OperatorChrome.tsx");
  assert.match(src, /if \(isOutputSurfacePath\(pathname\)\) return null;/);
});

console.log("output pages don't mount operator-only UI themselves:");
for (const f of ["src/app/live/page.tsx", "src/app/stage/page.tsx", "src/app/livestream/page.tsx", "src/app/ndi/page.tsx"]) {
  check(`${f} has no update / what's-new / announcement component`, () => {
    const s = read(f);
    for (const bad of ["UpdatePrompt", "UpdateBanner", "AnnouncementBar", "WhatsNewModal", "OfflineIndicator"]) assert.ok(!s.includes(bad), bad);
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
