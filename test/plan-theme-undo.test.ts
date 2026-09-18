// Review fix 🟡7: plan theme Undo continues past failures; deleted theme → cleared.
// Run: npx tsx test/plan-theme-undo.test.ts
import assert from "node:assert/strict";
import { undoPlanTheme } from "../src/lib/plan-theme-undo";

let pass = 0, fail = 0;
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log("  PASS " + name); pass++; }
  catch (e) { console.error("  FAIL " + name + "\n    " + (e as Error).message); fail++; }
}
(async () => {
  await check("continues past failures and counts them", async () => {
    const calls: string[] = [];
    const res = await undoPlanTheme(
      [{ itemId: "i1", themeId: "t1" }, { itemId: "i2", themeId: "t2" }, { itemId: "i3", themeId: null }],
      [{ songId: "s1", previousThemeId: null }, { songId: "s2", previousThemeId: "t1" }],
      {
        setItemTheme: async (id, t) => { calls.push(`item:${id}:${t}`); return id === "i1" ? { ok: false, error: "boom" } : { ok: true }; },
        applySongTheme: async (t, s) => { calls.push(`apply:${s}:${t}`); return { ok: false, error: "boom" }; },
        revertSong: async (s) => { calls.push(`revert:${s}`); return { ok: true }; },
      });
    assert.deepEqual(res, { failed: 2, clearedDeleted: 0 });
    assert.deepEqual(calls, ["item:i1:t1", "item:i2:t2", "item:i3:null", "revert:s1", "apply:s2:t1"]);
  });
  await check("deleted previous theme is cleared to none (item + song), not an abort", async () => {
    const calls: string[] = [];
    const res = await undoPlanTheme(
      [{ itemId: "i1", themeId: "gone" }, { itemId: "i2", themeId: "t2" }],
      [{ songId: "s1", previousThemeId: "gone" }],
      {
        setItemTheme: async (id, t) => { calls.push(`item:${id}:${t}`); return t === "gone" ? { ok: false, error: "Theme not found" } : { ok: true }; },
        applySongTheme: async () => ({ ok: false, error: "Theme not found" }),
        revertSong: async (s) => { calls.push(`revert:${s}`); return { ok: true }; },
      });
    assert.deepEqual(res, { failed: 0, clearedDeleted: 2 });
    assert.deepEqual(calls, ["item:i1:gone", "item:i1:null", "item:i2:t2", "revert:s1"]);
  });
  await check("a throwing call is counted, not fatal", async () => {
    const res = await undoPlanTheme([{ itemId: "i1", themeId: null }], [], {
      setItemTheme: async () => { throw new Error("network"); }, applySongTheme: async () => ({ ok: true }), revertSong: async () => ({ ok: true }),
    });
    assert.deepEqual(res, { failed: 1, clearedDeleted: 0 });
  });
  console.log(`\nplan-theme-undo: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
