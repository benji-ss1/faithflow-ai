/**
 * Offline resilience — the two failures that cost a church a service.
 * Run: npx tsx --test test/offline-resilience.test.ts
 *
 * These are STRUCTURAL guards, not behavioural ones, and that is deliberate:
 * the Electron load path cannot be exercised headlessly, and the thing that
 * actually breaks is someone later "simplifying" the guard away. So each test
 * names the failure it prevents, in the words of the incident.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const main = readFileSync("electron/main.ts", "utf8");
const layout = readFileSync("src/app/layout.tsx", "utf8");
const platform = readFileSync("src/lib/platform.ts", "utf8");

test("a failed navigation cannot tear down a LIVE operator console", () => {
  // The handler must consult the renderer before recovering. Without this,
  // a flapping venue AP mid-service replaces a hydrated console — its Bible
  // cache, its loaded slides, its BroadcastChannel wiring — with the splash
  // and an infinite retry loop.
  const handler = main.slice(main.indexOf('on("did-fail-load"'));
  const body = handler.slice(0, handler.indexOf('on("render-process-gone"'));
  assert.match(body, /appStillAlive\(\)/,
    "did-fail-load recovers without asking whether the app is still up");
  assert.match(body, /if \(await appStillAlive\(\)\)/);
});

test("the liveness probe fails CLOSED, so every uncertain case still recovers", () => {
  const fn = main.slice(main.indexOf("const appStillAlive"));
  const body = fn.slice(0, fn.indexOf('on("did-fail-load"'));
  assert.match(body, /catch\s*\{\s*return false/, "a throwing probe must not claim the app is alive");
  assert.match(body, /setTimeout\(/, "a hung renderer must not block recovery forever");
  assert.match(body, /=== true/, "only an explicit yes counts as alive");
});

test("a renderer crash still recovers — it has nothing to preserve", () => {
  const h = main.slice(main.indexOf('on("render-process-gone"'));
  assert.match(h.slice(0, 400), /loadWithRecovery/);
  assert.doesNotMatch(h.slice(0, 400), /appStillAlive/,
    "a dead renderer cannot answer a probe; gating this on one would hang the recovery");
});

test("the liveness marker is set by the DOCUMENT, never the preload", () => {
  // The preload runs on Chromium error pages too, so a preload-set flag would
  // claim the app is alive in exactly the case this must catch.
  assert.match(layout, /APP_ALIVE_SCRIPT/, "layout no longer emits the marker — the probe can never succeed");
  assert.match(platform, /__pfAppAlive/);
  const preload = readFileSync("electron/preload.ts", "utf8");
  assert.doesNotMatch(preload, /__pfAppAlive/,
    "the marker must not be set from the preload — it would be true on error pages");
});

test("Bible lookups go through the offline chapter cache, not a raw POST", () => {
  // Three call sites bypassed the cache, so a fully hydrated KJV was still
  // unusable offline on exactly the paths an operator reaches for.
  for (const f of [
    "src/components/operator/useVerseBank.ts",
    "src/components/operator/OperatorConsole.tsx",
  ]) {
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /fetch\("\/api\/bible\/lookup"/,
      `${f} still POSTs /api/bible/lookup directly — it will fail offline`);
    assert.match(src, /lookupWithWindowCached/, `${f} must resolve verses through the cache`);
  }
});

test("the safety-net song poll does not fire while offline", () => {
  const src = readFileSync("src/components/operator/OperatorConsole.tsx", "utf8");
  const iv = src.slice(src.indexOf("const iv = window.setInterval"));
  assert.match(iv.slice(0, 300), /navigator\.onLine === false/);
});
