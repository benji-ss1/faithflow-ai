// PR B: per-church styles store — synchronous reads before/after hydrate,
// stable references (send-path identity), legacy read-only fallback, first-render
// seed, pending-write protection, peer (BroadcastChannel) apply, retry + adopt.
// Run: npx tsx test/church-styles-store.test.ts
import assert from "node:assert/strict";

const store = new Map<string, string>();
const events: string[] = [];
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  },
  dispatchEvent: (e: { type: string }) => { events.push(e.type); return true; },
};

import {
  hydrateChurchStyles, hydrateChurchStylesInitial, getScriptureStyle, getContentTypeStyles, applyPeerChurchStyles,
  registerChurchStylesRemote, flushPending, hasPendingChurchStyles, __resetChurchStylesStore, churchStylesSnapshotFromPrefs,
  isContentTypeEditDenied, restorePendingWrites,
  type ChurchStylesSnapshot, type PendingWrites,
} from "../src/lib/church-styles-store";
import { loadScriptureStyle, saveScriptureStyle, clearScriptureStyle, hasSavedScriptureStyle, applyChurchLayout, DEFAULT_SCRIPTURE_DESIGN } from "../src/components/operator/scripture/scriptureStyle";
import { loadContentTypeStyles, saveContentTypeStyles } from "../src/lib/content-type-styles";
import type { SlidePayload } from "../src/lib/broadcast";

let pass = 0, fail = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  __resetChurchStylesStore(); store.clear(); events.length = 0;
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).stack}`); fail++; }
}
const A = "aaaaaaaa-0000-0000-0000-000000000001";
const B = "bbbbbbbb-0000-0000-0000-000000000002";
const T1 = "11111111-1111-1111-1111-111111111111";
const T2 = "22222222-2222-2222-2222-222222222222";
const lower = { ...DEFAULT_SCRIPTURE_DESIGN, layout: "lowerThird" as const };
const snap = (s: unknown, cts: unknown = {}, at: string | null = null): ChurchStylesSnapshot => ({ scriptureStyle: s, contentTypeStyles: cts, scriptureStyleUpdatedAt: at });
const VERSE: SlidePayload = { kind: "text", text: "For God so loved the world", reference: "John 3:16 (KJV)" };
const SONG: SlidePayload = { kind: "text", text: "Amazing grace" };

async function main() {
  await check("before hydrate: legacy per-machine key is the read-only fallback", () => {
    store.set(`pf.scriptureStyle.v2.${A}`, JSON.stringify(lower));
    assert.equal(loadScriptureStyle(A).layout, "lowerThird");
    assert.equal(hasSavedScriptureStyle(A), true);
    assert.equal(hasSavedScriptureStyle(B), false, "church B never sees church A's legacy key");
    assert.equal(loadScriptureStyle(A), loadScriptureStyle(A), "legacy fallback is identity-stable (memoised)");
  });

  await check("after hydrate: server value wins over legacy, stable reference", () => {
    store.set(`pf.scriptureStyle.v2.${A}`, JSON.stringify(lower));
    store.set(`pf.stylesMigrated.${A}`, "1");
    hydrateChurchStylesInitial(A, snap({ ...DEFAULT_SCRIPTURE_DESIGN, verse: { ...DEFAULT_SCRIPTURE_DESIGN.verse, fontSize: 120 } }, {}, "2026-09-17T10:00:00.000Z"));
    const d1 = loadScriptureStyle(A);
    assert.equal(d1.layout, "fullscreen");
    assert.equal(d1.verse.fontSize, 120);
    assert.equal(loadScriptureStyle(A), d1, "same object between calls");
    // equal re-hydrate keeps the reference
    hydrateChurchStyles(A, snap({ ...DEFAULT_SCRIPTURE_DESIGN, verse: { ...DEFAULT_SCRIPTURE_DESIGN.verse, fontSize: 120 } }, {}, "2026-09-17T10:00:01.000Z"));
    assert.equal(loadScriptureStyle(A), d1, "equal newer snapshot keeps the reference");
  });

  await check("hydrated server null → no saved style (theme options apply), legacy ignored once migrated", () => {
    store.set(`pf.scriptureStyle.v2.${A}`, JSON.stringify(lower));
    store.set(`pf.stylesMigrated.${A}`, "1");
    hydrateChurchStylesInitial(A, snap(null));
    assert.equal(hasSavedScriptureStyle(A), false);
    assert.equal(loadScriptureStyle(A), DEFAULT_SCRIPTURE_DESIGN);
  });

  await check("first render seeds legacy locally when server empty + not migrated (no visual change on upgrade)", () => {
    store.set(`pf.scriptureStyle.v2.${A}`, JSON.stringify(lower));
    store.set("presentflow.contentTypeStyles.v1", JSON.stringify({ song: T1 }));
    hydrateChurchStylesInitial(A, snap(null, {}));
    assert.equal(loadScriptureStyle(A).layout, "lowerThird");
    assert.deepEqual(loadContentTypeStyles(A), { song: T1 });
  });

  await check("server has a style → legacy NOT seeded (first computer already won)", () => {
    store.set(`pf.scriptureStyle.v2.${A}`, JSON.stringify(lower));
    hydrateChurchStylesInitial(A, snap(DEFAULT_SCRIPTURE_DESIGN, {}, "2026-09-17T10:00:00.000Z"));
    assert.equal(loadScriptureStyle(A).layout, "fullscreen");
  });

  await check("a deliberate clear (null + updated_at) is never re-seeded from legacy", () => {
    store.set(`pf.scriptureStyle.v2.${A}`, JSON.stringify(lower));
    hydrateChurchStylesInitial(A, snap(null, {}, "2026-09-17T10:00:00.000Z"));
    assert.equal(hasSavedScriptureStyle(A), false);
  });

  await check("applyChurchLayout is identity-stable across heartbeats (same cached design)", () => {
    hydrateChurchStylesInitial(A, snap(lower, {}, "2026-09-17T10:00:00.000Z"));
    const s1 = applyChurchLayout(SONG, A), s2 = applyChurchLayout(SONG, A);
    assert.deepEqual(s1, s2);
    assert.equal((s1 as { scriptureLayout?: string }).scriptureLayout, "lowerThird");
    const v1 = applyChurchLayout(VERSE, A), v2 = applyChurchLayout(VERSE, A);
    assert.deepEqual({ ...v1, objects: undefined }, { ...v2, objects: undefined });
    const img: SlidePayload = { kind: "image", url: "https://a.b/c.png" };
    assert.deepEqual(applyChurchLayout(img, A), applyChurchLayout(img, A));
  });

  await check("church isolation: hydrating B never changes A", () => {
    hydrateChurchStylesInitial(A, snap(lower, { song: T1 }, "2026-09-17T10:00:00.000Z"));
    hydrateChurchStylesInitial(B, snap(null, { song: T2 }));
    assert.equal(loadScriptureStyle(A).layout, "lowerThird");
    assert.equal(hasSavedScriptureStyle(B), false);
    assert.deepEqual(loadContentTypeStyles(A), { song: T1 });
    assert.deepEqual(loadContentTypeStyles(B), { song: T2 });
  });

  await check("save updates cache synchronously + dispatches events + stays pending until remote ok", async () => {
    hydrateChurchStylesInitial(A, snap(null, {}));
    saveScriptureStyle(A, lower);
    assert.equal(loadScriptureStyle(A).layout, "lowerThird");
    assert.ok(events.includes("pf-scripture-style-changed"));
    assert.equal(hasPendingChurchStyles(A), true, "no remote yet → pending");
    saveContentTypeStyles({ scripture: T1 }, A);
    assert.ok(events.includes("presentflow:content-type-styles-changed"));
    const calls: string[] = [];
    registerChurchStylesRemote({
      saveScripture: async (_c, d) => { calls.push("s"); return { status: "ok", snap: snap(d, {}, "2026-09-17T11:00:00.000Z") }; },
      saveContentTypeStyles: async () => { calls.push("c"); return { status: "ok", snap: { ...snap(lower, {}, "2026-09-17T11:00:00.000Z"), contentTypeStylesUpdatedAt: "2026-09-17T11:00:00.000Z" } }; }, // server dropped foreign id
    });
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(calls, ["s", "c"]);
    assert.equal(hasPendingChurchStyles(A), false);
    assert.deepEqual(loadContentTypeStyles(A), {}, "adopts server-sanitized content-type styles");
  });

  await check("failed save stays pending (retry on online) and fires onFailure", async () => {
    hydrateChurchStylesInitial(A, snap(null, {}));
    let failures = 0, ok = false;
    registerChurchStylesRemote({
      saveScripture: async (_c, d) => { if (!ok) throw new Error("offline"); return { status: "ok", snap: snap(d, {}, "2026-09-17T12:00:00.000Z") }; },
      saveContentTypeStyles: async () => null,
      onFailure: () => { failures++; },
    });
    clearScriptureStyle(A);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(failures, 1);
    assert.equal(hasPendingChurchStyles(A), true);
    ok = true;
    await flushPending(A);
    assert.equal(hasPendingChurchStyles(A), false);
    assert.equal(hasSavedScriptureStyle(A), false);
  });

  await check("realtime hydrate does not clobber a pending local write; older server value ignored", () => {
    hydrateChurchStylesInitial(A, snap(DEFAULT_SCRIPTURE_DESIGN, {}, "2026-09-17T10:00:00.000Z"));
    saveScriptureStyle(A, lower); // pending, no remote
    hydrateChurchStyles(A, snap(DEFAULT_SCRIPTURE_DESIGN, {}, "2026-09-17T10:05:00.000Z"));
    assert.equal(loadScriptureStyle(A).layout, "lowerThird", "pending write wins until acknowledged");
    __resetChurchStylesStore();
    hydrateChurchStylesInitial(A, snap(lower, {}, "2026-09-17T10:05:00.000Z"));
    hydrateChurchStyles(A, snap(DEFAULT_SCRIPTURE_DESIGN, {}, "2026-09-17T10:00:00.000Z"));
    assert.equal(loadScriptureStyle(A).layout, "lowerThird", "older server snapshot ignored");
    hydrateChurchStyles(A, snap(DEFAULT_SCRIPTURE_DESIGN, {}, "2026-09-17T10:06:00.000Z"));
    assert.equal(loadScriptureStyle(A).layout, "fullscreen", "newer server snapshot applied");
  });

  await check("stale remount props never roll back a hydrated window", () => {
    hydrateChurchStylesInitial(A, snap(lower, {}, "2026-09-17T10:05:00.000Z"));
    hydrateChurchStylesInitial(A, snap(null, {}, null));
    assert.equal(loadScriptureStyle(A).layout, "lowerThird");
  });

  await check("peer (BroadcastChannel) update applies only to windows that loaded that church", () => {
    hydrateChurchStylesInitial(A, snap(null, {}));
    applyPeerChurchStyles(A, snap(lower, { song: T2 }));
    assert.equal(loadScriptureStyle(A).layout, "lowerThird");
    assert.deepEqual(getContentTypeStyles(A), { song: T2 });
    applyPeerChurchStyles(B, snap(lower, {}));
    assert.equal(getScriptureStyle(B), null);
  });


  await check("#2 seeded legacy content-type themes survive refetches while the server value is never-set", () => {
    store.set("presentflow.contentTypeStyles.v1", JSON.stringify({ song: T1, scripture: T2 }));
    hydrateChurchStylesInitial(A, snap(null, {}));
    assert.deepEqual(loadContentTypeStyles(A), { song: T1, scripture: T2 });
    // focus / realtime / 60s poll refetch returns the still-empty never-set server row
    hydrateChurchStyles(A, { ...snap(null, {}), contentTypeStylesUpdatedAt: null });
    hydrateChurchStyles(A, snap(null, {}));
    assert.deepEqual(loadContentTypeStyles(A), { song: T1, scripture: T2 }, "never wiped mid-service");
    // once ANY computer actually sets them (updated_at non-null), the server value is adopted
    hydrateChurchStyles(A, { ...snap(null, { song: T2 }), contentTypeStylesUpdatedAt: "2026-09-17T13:00:00.000Z" });
    assert.deepEqual(loadContentTypeStyles(A), { song: T2 });
    // and an OLDER set is ignored
    hydrateChurchStyles(A, { ...snap(null, { song: T1 }), contentTypeStylesUpdatedAt: "2026-09-17T12:00:00.000Z" });
    assert.deepEqual(loadContentTypeStyles(A), { song: T2 });
  });

  await check("#2 legacy content-type themes NOT seeded when the church deliberately emptied them", () => {
    store.set("presentflow.contentTypeStyles.v1", JSON.stringify({ song: T1 }));
    hydrateChurchStylesInitial(A, { ...snap(null, {}), contentTypeStylesUpdatedAt: "2026-09-17T10:00:00.000Z" });
    assert.deepEqual(loadContentTypeStyles(A), {});
  });

  await check("#3 a refused save is dropped (no retry, one failure) and the server value adopted; picker marked denied", async () => {
    hydrateChurchStylesInitial(A, { ...snap(lower, { song: T1 }, "2026-09-17T10:00:00.000Z"), contentTypeStylesUpdatedAt: "2026-09-17T10:00:00.000Z" });
    const fails: string[] = [];
    let calls = 0;
    registerChurchStylesRemote({
      saveScripture: async () => ({ status: "rejected", snap: snap(lower, { song: T1 }, "2026-09-17T10:00:00.000Z"), error: "Not permitted" }),
      saveContentTypeStyles: async () => { calls++; return { status: "rejected", snap: { ...snap(lower, { song: T1 }, "2026-09-17T10:00:00.000Z"), contentTypeStylesUpdatedAt: "2026-09-17T10:00:00.000Z" }, error: "Not permitted" }; },
      onFailure: (_w, kind) => { fails.push(kind); },
    });
    saveContentTypeStyles({ song: T2 }, A);
    assert.deepEqual(loadContentTypeStyles(A), { song: T2 }, "optimistic");
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(hasPendingChurchStyles(A), false, "dropped, not stuck pending");
    assert.deepEqual(loadContentTypeStyles(A), { song: T1 }, "server value adopted — no stuck local override");
    assert.equal(isContentTypeEditDenied(A), true);
    await flushPending(A);
    assert.equal(calls, 1, "never retried");
    assert.deepEqual(fails, ["rejected"], "toasted once");
    saveScriptureStyle(A, DEFAULT_SCRIPTURE_DESIGN);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(loadScriptureStyle(A).layout, "lowerThird", "refused scripture save also reverts to server");
  });

  await check("#3 wrong-church refusal drops the write without adopting anything", async () => {
    hydrateChurchStylesInitial(A, snap(lower, {}, "2026-09-17T10:00:00.000Z"));
    registerChurchStylesRemote({
      saveScripture: async () => ({ status: "rejected", snap: null, error: "Wrong church" }),
      saveContentTypeStyles: async () => null,
    });
    clearScriptureStyle(A);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(hasPendingChurchStyles(A), false);
  });

  await check("#5 pending writes are persisted with the snapshot and restored after a reload", async () => {
    const persisted: { pending: PendingWrites }[] = [];
    hydrateChurchStylesInitial(A, snap(null, {}));
    registerChurchStylesRemote({
      saveScripture: async () => { throw new Error("offline"); },
      saveContentTypeStyles: async () => { throw new Error("offline"); },
      persistOffline: (_c, _s, pending) => { persisted.push({ pending }); },
    });
    saveScriptureStyle(A, lower);
    await new Promise((r) => setTimeout(r, 10));
    const last = persisted[persisted.length - 1];
    assert.equal(last.pending.scripture?.v?.layout, "lowerThird", "dirty flag persisted while offline");
    // reload: fresh store, server props still empty, offline record restores the pending write
    __resetChurchStylesStore();
    hydrateChurchStylesInitial(A, snap(null, {}));
    const sent: string[] = [];
    registerChurchStylesRemote({
      saveScripture: async (_c, d) => { sent.push(d?.layout ?? "null"); return { status: "ok", snap: snap(d, {}, "2026-09-17T14:00:00.000Z") }; },
      saveContentTypeStyles: async () => null,
    });
    restorePendingWrites(A, last.pending);
    assert.equal(loadScriptureStyle(A).layout, "lowerThird");
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(sent, ["lowerThird"], "flushed on reconnect");
    assert.equal(hasPendingChurchStyles(A), false);
  });

  await check("#7 first-render seed does not dispatch synchronously (no events during render)", async () => {
    store.set(`pf.scriptureStyle.v2.${A}`, JSON.stringify(lower));
    events.length = 0;
    hydrateChurchStylesInitial(A, snap(null, {}));
    assert.equal(events.length, 0, "nothing dispatched inside the render");
    await Promise.resolve();
    assert.ok(events.includes("pf-scripture-style-changed"), "dispatched on the microtask");
  });

  await check("snapshot from prefs row", () => {
    assert.deepEqual(churchStylesSnapshotFromPrefs(null), { scriptureStyle: null, contentTypeStyles: {}, scriptureStyleUpdatedAt: null, contentTypeStylesUpdatedAt: null });
    assert.equal(churchStylesSnapshotFromPrefs({ scriptureStyleUpdatedAt: new Date("2026-09-17T10:00:00Z") }).scriptureStyleUpdatedAt, "2026-09-17T10:00:00.000Z");
  });

  await check("server (no window) is a pure no-op — cache can't leak across requests", async () => {
    const w = (globalThis as { window?: unknown }).window;
    delete (globalThis as { window?: unknown }).window;
    try {
      hydrateChurchStyles(A, snap(lower, { song: T1 }, "2026-09-17T10:00:00.000Z"));
      saveScriptureStyle(A, lower);
      assert.equal(loadScriptureStyle(A), DEFAULT_SCRIPTURE_DESIGN);
      assert.deepEqual(loadContentTypeStyles(A), {});
    } finally { (globalThis as { window?: unknown }).window = w; }
    assert.equal(getScriptureStyle(A), null, "nothing was cached while window was undefined");
  });

  console.log(`\nchurch-styles-store: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
void main();
