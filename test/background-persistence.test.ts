/**
 * Background Templates — "last explicit pick wins" persistence.
 *
 * Regression cover for the bug where the operator's chosen background template
 * (e.g. Gentle Waves) was wiped on every app restart because the default theme
 * carried its own background, AND for custom (uploaded) backgrounds being
 * silently coerced to "none" so they could never persist as active.
 *
 * Run: npx tsx test/background-persistence.test.ts
 */
import assert from "node:assert";

// ── Minimal localStorage + window shim (module reads these at call time) ──────
class MemStore {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const g = globalThis as unknown as { localStorage: MemStore; window: { localStorage: MemStore; dispatchEvent: () => boolean } };
const mem = new MemStore();
g.localStorage = mem;
g.window = { localStorage: mem, dispatchEvent: () => true };

// Static import is safe: the store only touches localStorage inside functions
// (guarded by isBrowser() at call time), which we invoke after the shim is set.
import {
  setActiveBackgroundId,
  readActiveBackgroundId,
  markThemeBackgroundPicked,
  shouldKeepTemplateOverThemeBg,
  addCustomBackground,
  snapshotBackgroundState,
  restoreBackgroundState,
} from "../src/backgrounds/store/backgroundStore";

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${(e as Error).message}`); failed++; }
}
// Advance the clock deterministically so ordering is unambiguous (Date.now()
// can return the same ms twice on a fast machine).
let t = 1_000_000;
const realNow = Date.now;
function tick() { t += 10; return t; }
(Date as unknown as { now: () => number }).now = () => t;

test("built-in template persists as the active id", () => {
  mem.clear();
  setActiveBackgroundId("gentleWaves");
  assert.equal(readActiveBackgroundId(), "gentleWaves");
});

test("custom uploaded background persists as active (not coerced to none)", () => {
  mem.clear();
  addCustomBackground({ id: "custom-abc", name: "My Image", type: "image", imageUrl: "https://x/y.jpg", isBuiltIn: false } as never);
  setActiveBackgroundId("custom-abc");
  assert.equal(readActiveBackgroundId(), "custom-abc");
});

test("unknown id still falls back to none", () => {
  mem.clear();
  setActiveBackgroundId("does-not-exist");
  assert.equal(readActiveBackgroundId(), "none");
});

test("template picked AFTER theme bg → template wins on restart", () => {
  mem.clear();
  markThemeBackgroundPicked();     // theme bg chosen first
  tick();
  setActiveBackgroundId("gentleWaves"); // then template — most recent pick
  assert.equal(shouldKeepTemplateOverThemeBg(), true);
});

test("theme bg picked AFTER template → theme bg wins on restart", () => {
  mem.clear();
  setActiveBackgroundId("gentleWaves"); // template first
  tick();
  markThemeBackgroundPicked();          // then theme bg — most recent pick
  assert.equal(shouldKeepTemplateOverThemeBg(), false);
});

test("fresh install (no picks) → theme bg wins (keeps existing invariant)", () => {
  mem.clear();
  assert.equal(shouldKeepTemplateOverThemeBg(), false);
});

test("selecting none does NOT stamp a template pick (can't out-rank theme bg)", () => {
  mem.clear();
  markThemeBackgroundPicked();
  tick();
  setActiveBackgroundId("none"); // a clear, not a pick
  assert.equal(shouldKeepTemplateOverThemeBg(), false);
});

test("corrupt timestamp values are treated as 0 (no crash)", () => {
  mem.clear();
  mem.setItem("presentflow.backgrounds.pickedAt.v1", "not-a-number");
  mem.setItem("presentflow.backgrounds.themeBgPickedAt.v1", "NaN");
  assert.equal(shouldKeepTemplateOverThemeBg(), false); // 0 > 0 === false, no throw
});

test("Undo path: snapshot then restore brings the exact template + stamps back", () => {
  mem.clear();
  // Operator had Gentle Waves active (picked most recently).
  markThemeBackgroundPicked();
  tick();
  setActiveBackgroundId("gentleWaves");
  const snap = snapshotBackgroundState();
  assert.equal(snap.activeId, "gentleWaves");
  assert.equal(shouldKeepTemplateOverThemeBg(), true);
  // "Set as theme background" would clear the template + stamp theme bg newer.
  setActiveBackgroundId("none");
  tick();
  markThemeBackgroundPicked();
  assert.equal(readActiveBackgroundId(), "none");
  assert.equal(shouldKeepTemplateOverThemeBg(), false);
  // Undo restores the snapshot exactly → template back AND it wins again.
  restoreBackgroundState(snap);
  assert.equal(readActiveBackgroundId(), "gentleWaves");
  assert.equal(shouldKeepTemplateOverThemeBg(), true);
});

(Date as unknown as { now: () => number }).now = realNow;
console.log(`\n=== background-persistence: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
