/**
 * Song theme cold-start race (2026-09-17): on a fresh operator session the ONE
 * /api/themes fetch could fail, leaving the themes cache empty. Every later
 * resolve then silently fell back to the built-in default look (Sora/white, no
 * background) even though the church's content-type default was correct in the
 * page payload and the DB, and nothing ever re-resolved it.
 *
 * Locks: a failed cold-start load retries (bounded), and once the themes
 * arrive the SAME resolver produces the content-type theme's appearance.
 * Run: npx tsx test/themes-retry.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadThemesWithRetry, themesRetryDelay, THEMES_RETRY_MS } from "../src/lib/themes-retry";
import { resolveItemThemeConfig } from "../src/lib/live-item-theme";

let pass = 0, fail = 0;
const check = (n: string, fn: () => void | Promise<void>) => {
  const done = () => { console.log(`  PASS  ${n}`); pass++; };
  const bad = (e: unknown) => { console.error(`  FAIL  ${n}\n        ${(e as Error).message.slice(0, 400)}`); fail++; };
  try { const r = fn(); return r instanceof Promise ? r.then(done, bad) : (done(), Promise.resolve()); }
  catch (e) { bad(e); return Promise.resolve(); }
};

/** Drains injected timers immediately, recording the delays that were used. */
function runner(attempt: () => Promise<boolean>) {
  const delays: number[] = [];
  const queue: Array<() => void> = [];
  const p = loadThemesWithRetry({
    attempt,
    isCancelled: () => false,
    schedule: (fn, ms) => { delays.push(ms); queue.push(fn); },
  });
  return { delays, queue, p };
}
async function drain(r: ReturnType<typeof runner>, max = 20) {
  await r.p;
  for (let i = 0; i < max && r.queue.length; i++) { const fn = r.queue.shift()!; fn(); await new Promise((res) => setImmediate(res)); }
}

const THEME = { bgType: "image", bgImageUrl: "/bg.png", textColor: "#ffee00", fontFamily: "Georgia" };
const CTS = { song: "theme-a" };
const SONG_ITEM = { type: "song" };

async function main() {
  await check("backoff is bounded and monotonic", () => {
    assert.equal(themesRetryDelay(-1), null);
    assert.equal(themesRetryDelay(THEMES_RETRY_MS.length), null);
    for (let i = 1; i < THEMES_RETRY_MS.length; i++) assert.ok(THEMES_RETRY_MS[i] > THEMES_RETRY_MS[i - 1]);
  });

  await check("a successful first load never retries (no extra /api/themes traffic)", async () => {
    let calls = 0;
    const r = runner(async () => { calls++; return true; });
    await drain(r);
    assert.equal(calls, 1);
    assert.deepEqual(r.delays, []);
  });

  await check("a church with NO themes is a success — still no retry", async () => {
    // load() reports true for a healthy fetch that returned an empty list.
    let calls = 0;
    const r = runner(async () => { calls++; return true; });
    await drain(r);
    assert.equal(calls, 1);
  });

  await check("a failed cold-start load retries until it succeeds", async () => {
    let calls = 0;
    const r = runner(async () => { calls++; return calls >= 3; });
    await drain(r);
    assert.equal(calls, 3);
    assert.deepEqual(r.delays, [THEMES_RETRY_MS[0], THEMES_RETRY_MS[1]]);
  });

  await check("a throwing attempt counts as a failure and is retried", async () => {
    let calls = 0;
    const r = runner(async () => { calls++; if (calls === 1) throw new Error("Failed to fetch"); return true; });
    await drain(r);
    assert.equal(calls, 2);
  });

  await check("retries are bounded — a permanently dead route stops trying", async () => {
    let calls = 0;
    const r = runner(async () => { calls++; return false; });
    await drain(r, 50);
    assert.equal(calls, THEMES_RETRY_MS.length + 1);
    assert.equal(r.queue.length, 0);
  });

  await check("unmount cancels: no attempt and nothing scheduled", async () => {
    let calls = 0;
    await loadThemesWithRetry({
      attempt: async () => { calls++; return false; },
      isCancelled: () => true,
      schedule: () => { throw new Error("must not schedule after unmount"); },
    });
    assert.equal(calls, 0);
  });

  await check("THE BUG: empty cache resolves to the default, and to the theme once it arrives", async () => {
    const cache = new Map<string, unknown>();
    const byId = (id: string) => cache.get(id);
    // Cold start — themes not loaded yet: falls back to the church default (null).
    assert.equal(resolveItemThemeConfig(SONG_ITEM, CTS, byId), null);
    // First attempt fails (the cold-start race), the retry lands and fills it.
    let calls = 0;
    const r = runner(async () => { calls++; if (calls === 1) return false; cache.set("theme-a", THEME); return true; });
    await drain(r);
    assert.equal(calls, 2);
    // …and the SAME resolver now produces the content-type theme. Nothing else
    // had to change: `themesVersion` bumping re-runs exactly this call.
    assert.equal(resolveItemThemeConfig(SONG_ITEM, CTS, byId), THEME);
  });

  await check("OperatorConsole wires the retry and guards the caches against a stale run", () => {
    const src = readFileSync(new URL("../src/components/operator/OperatorConsole.tsx", import.meta.url), "utf8");
    assert.ok(src.includes("loadThemesWithRetry({"), "mount load must go through the retry");
    assert.ok(/isCancelled: \(\) => cancelled/.test(src), "retry must stop on unmount");
    assert.ok(src.includes("for (const t of retryTimers) window.clearTimeout(t);"), "retry timers must be cleared on unmount");
    const apply = src.slice(src.indexOf("const applyList = async"), src.indexOf("const load = async"));
    assert.ok(apply.indexOf("if (cancelled) return;") < apply.indexOf("themesByIdRef.current = new Map"),
      "a cancelled run must not clobber the theme caches without bumping themesVersion");
    // No re-send / re-pulse: the fix only bumps themesVersion (appearance), it
    // must not touch the live send path or output identity.
    assert.ok(!/loadThemesWithRetry[\s\S]{0,800}sendSlideToLive/.test(src));
  });

}

void main().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
});
