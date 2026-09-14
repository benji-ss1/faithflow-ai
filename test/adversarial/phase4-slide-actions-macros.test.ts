// Adversarial cross-church test — Phase 4 slide actions + Automations (macros).
//
// CLAUDE.md rule 5: every new church-scoped write path needs an adversarial
// test. Seeds two ephemeral churches (A, B) in the LOCAL DB and drives the REAL
// church-scoped DB core (src/lib/server/automations.ts — the exact functions the
// "use server" wrappers in src/lib/actions.ts call with the session churchId)
// as Church B against Church A's ids.
//
// RUN
//   npx tsx --env-file=.env.local test/adversarial/phase4-slide-actions-macros.test.ts
//
// Refuses to run against a non-localhost DATABASE_URL.

import { eq, inArray } from "drizzle-orm";
import { getDb } from "../../src/lib/db/client";
import { churches, servicePlans, serviceItems, songs, songSlides, macros } from "../../src/lib/db/schema";
import {
  setSongSlideActionsCore, setServiceItemSlideActionsCore,
  listMacrosCore, createMacroCore, updateMacroCore, deleteMacroCore,
  stripClientSlideActions,
} from "../../src/lib/server/automations";
import { getExpandedServicePlan } from "../../src/lib/server/services";
import { MAX_MACROS_PER_CHURCH } from "../../src/engine/macros";
import { specKey } from "../../src/engine/actions/describe";
// jsonb does not preserve key order — compare content, not byte strings.
const same = (a: unknown, b: unknown) => specKey(a) === specKey(b);

function isLocalDbUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (!["localhost", "127.0.0.1"].includes(u.hostname)) return false;
  // libpq honours ?host= over the authority — a remote host smuggled there must refuse.
  for (const k of u.searchParams.keys()) if (k.toLowerCase() === "host" || k.toLowerCase() === "hostaddr") return false;
  return true;
}
if (!isLocalDbUrl(process.env.DATABASE_URL ?? "")) {
  console.error("REFUSING: DATABASE_URL is not a localhost database.");
  process.exit(2);
}

type Attempt = { name: string; pass: boolean; detail: string };
const results: Attempt[] = [];
function record(name: string, pass: boolean, detail = "") {
  results.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

const timer = { type: "timer", timerId: "t1", command: "start" };
const msg = { type: "show_message", text: "Welcome" };

async function seed(name: string) {
  const db = getDb();
  const [ch] = await db.insert(churches).values({ name, timezone: "UTC" }).returning();
  const [plan] = await db.insert(servicePlans).values({ churchId: ch.id, title: `${name} plan` }).returning();
  const [song] = await db.insert(songs).values({ churchId: ch.id, title: `${name} song`, source: "church" }).returning();
  const [slide] = await db.insert(songSlides).values({ songId: song.id, order: 0, lyrics: "la la" }).returning();
  const [item] = await db.insert(serviceItems).values({
    servicePlanId: plan.id, order: 0, type: "scripture", title: "Reading",
    payload: { reference: "John 3:16", slides: [{ text: "For God so loved" }, { text: "the world" }] },
  }).returning();
  const [mac] = await db.insert(macros).values({ churchId: ch.id, name: `${name} macro`, actions: [timer] }).returning();
  return { church: ch, plan, song, slide, item, macro: mac };
}

async function cleanup(churchId: string) {
  const db = getDb();
  await db.delete(macros).where(eq(macros.churchId, churchId));
  const plans = await db.select({ id: servicePlans.id }).from(servicePlans).where(eq(servicePlans.churchId, churchId));
  if (plans.length) await db.delete(servicePlans).where(inArray(servicePlans.id, plans.map((p) => p.id)));
  const ss = await db.select({ id: songs.id }).from(songs).where(eq(songs.churchId, churchId));
  if (ss.length) await db.delete(songs).where(inArray(songs.id, ss.map((s) => s.id)));
  await db.delete(churches).where(eq(churches.id, churchId));
}

async function main() {
  console.log("=== Phase 4 slide actions + macros adversarial test ===");
  const db = getDb();
  let A: Awaited<ReturnType<typeof seed>> | null = null;
  let B: Awaited<ReturnType<typeof seed>> | null = null;
  try {
    A = await seed("P4-Adv-A");
    B = await seed("P4-Adv-B");

    // ── Macros: B vs A ──
    const bList = await listMacrosCore(db, B.church.id);
    record("B listMacros never returns A's macro", !bList.some((m) => m.id === A!.macro.id), `B sees ${bList.length}`);

    const up = await updateMacroCore(db, B.church.id, A.macro.id, { name: "pwned", actions: [msg], enabled: false });
    const [aMacAfterUp] = await db.select().from(macros).where(eq(macros.id, A.macro.id));
    record("B cannot update A's macro", !up.ok && aMacAfterUp.name === "P4-Adv-A macro" && aMacAfterUp.enabled === true, JSON.stringify(up));

    const del = await deleteMacroCore(db, B.church.id, A.macro.id);
    const [aMacAfterDel] = await db.select().from(macros).where(eq(macros.id, A.macro.id));
    record("B cannot delete A's macro", !del.ok && !!aMacAfterDel, JSON.stringify(del));

    const ownUp = await updateMacroCore(db, A.church.id, A.macro.id, { enabled: false });
    record("A can update its own macro (returning-based found)", ownUp.ok === true, JSON.stringify(ownUp));
    const ownUpBad = await updateMacroCore(db, A.church.id, A.macro.id, { name: "   " });
    record("empty trimmed name rejected cleanly", !ownUpBad.ok, JSON.stringify(ownUpBad));
    const ownUpBadEnabled = await updateMacroCore(db, A.church.id, A.macro.id, { enabled: "yes" });
    record("non-boolean enabled rejected", !ownUpBadEnabled.ok, JSON.stringify(ownUpBadEnabled));

    // ── Slide actions: B vs A ──
    const sa = await setSongSlideActionsCore(db, B.church.id, A.slide.id, [msg]);
    const [aSlide] = await db.select().from(songSlides).where(eq(songSlides.id, A.slide.id));
    record("B cannot set slide actions on A's song slide", !sa.ok && Array.isArray(aSlide.actions) && (aSlide.actions as unknown[]).length === 0, JSON.stringify(sa));

    const si = await setServiceItemSlideActionsCore(db, B.church.id, A.item.id, 0, [msg]);
    const [aItem] = await db.select().from(serviceItems).where(eq(serviceItems.id, A.item.id));
    record("B cannot set slide actions on A's service item", !si.ok && !(aItem.payload as Record<string, unknown>).slideActions, JSON.stringify(si));

    // ── Guarded actions rejected on slides ──
    for (const g of ["blank", "kill", "clear_all_layers"]) {
      const r = await setSongSlideActionsCore(db, A.church.id, A.slide.id, [timer, { type: g }]);
      const [row] = await db.select().from(songSlides).where(eq(songSlides.id, A.slide.id));
      record(`setSongSlideActions rejects guarded "${g}"`, !r.ok && (row.actions as unknown[]).length === 0, JSON.stringify(r));
      const r2 = await setServiceItemSlideActionsCore(db, A.church.id, A.item.id, 0, [{ type: g }]);
      record(`setServiceItemSlideActions rejects guarded "${g}"`, !r2.ok, JSON.stringify(r2));
    }

    // ── Extra keys / __proto__ / junk stripped on save ──
    const polluted = JSON.parse(`{"type":"show_message","text":"hi","junk":"${"x".repeat(1000)}","__proto__":{"admin":true},"nested":{"a":1}}`);
    const ok1 = await setSongSlideActionsCore(db, A.church.id, A.slide.id, [polluted]);
    const [cleanSlide] = await db.select().from(songSlides).where(eq(songSlides.id, A.slide.id));
    record("extra keys stripped on song slide save", ok1.ok && same(cleanSlide.actions, [{ type: "show_message", text: "hi" }]), JSON.stringify(cleanSlide.actions));

    const ok2 = await setServiceItemSlideActionsCore(db, A.church.id, A.item.id, 1, [polluted]);
    const [cleanItem] = await db.select().from(serviceItems).where(eq(serviceItems.id, A.item.id));
    const saMap = (cleanItem.payload as Record<string, unknown>).slideActions as Record<string, unknown>;
    record("extra keys stripped on service item save + other payload keys preserved",
      ok2.ok && same(saMap?.["1"], [{ type: "show_message", text: "hi" }]) && (cleanItem.payload as Record<string, unknown>).reference === "John 3:16",
      JSON.stringify(cleanItem.payload));

    // Oversized: 5MB of junk in an extra key is stripped (list still saves).
    const huge = { ...timer, pad: "y".repeat(5 * 1024 * 1024) };
    const ok3 = await createMacroCore(db, A.church.id, { name: "huge", actions: [huge] });
    const [hugeRow] = ok3.ok ? await db.select().from(macros).where(eq(macros.id, ok3.data!.id)) : [];
    record("5MB extra-key junk stripped from macro save", ok3.ok && JSON.stringify(hugeRow.actions).length < 200, `${hugeRow ? JSON.stringify(hugeRow.actions).length : "n/a"} bytes`);

    // Oversized in ALLOWED fields past the 32KB list cap → rejected.
    const bigMsgs = Array.from({ length: 20 }, () => ({ type: "show_message", text: "z".repeat(2000) }));
    const tooBig = await createMacroCore(db, A.church.id, { name: "big", actions: bigMsgs });
    record("macro list > 32KB serialized rejected", !tooBig.ok, JSON.stringify(tooBig));

    // Atomic single-key write: slide 1's key survives a write to slide 0, and a clear removes only its key.
    await setServiceItemSlideActionsCore(db, A.church.id, A.item.id, 0, [timer]);
    await setServiceItemSlideActionsCore(db, A.church.id, A.item.id, 1, []);
    const [afterClear] = await db.select().from(serviceItems).where(eq(serviceItems.id, A.item.id));
    const m2 = (afterClear.payload as Record<string, unknown>).slideActions as Record<string, unknown>;
    record("single-key write/clear keeps sibling keys", !!m2 && Array.isArray(m2["0"]) && !("1" in m2), JSON.stringify(m2));

    // A already has slideActions — B can neither overwrite nor clear them.
    const aBefore = ((await db.select().from(serviceItems).where(eq(serviceItems.id, A.item.id)))[0].payload as Record<string, unknown>).slideActions;
    const bMod = await setServiceItemSlideActionsCore(db, B.church.id, A.item.id, 0, [msg]);
    const bClr = await setServiceItemSlideActionsCore(db, B.church.id, A.item.id, 0, []);
    const aAfter = ((await db.select().from(serviceItems).where(eq(serviceItems.id, A.item.id)))[0].payload as Record<string, unknown>).slideActions;
    record("B cannot modify or clear A's EXISTING slideActions",
      !bMod.ok && !bClr.ok && bMod.error === "Item not found" && bClr.error === "Item not found" && same(aBefore, aAfter) && !!aBefore,
      JSON.stringify({ bMod, bClr, aAfter }));

    // Concurrent writes on different keys don't lose each other.
    await Promise.all(Array.from({ length: 10 }, (_, i) => setServiceItemSlideActionsCore(db, A!.church.id, A!.item.id, 10 + i, [timer])));
    const [afterConc] = await db.select().from(serviceItems).where(eq(serviceItems.id, A.item.id));
    const m3 = (afterConc.payload as Record<string, unknown>).slideActions as Record<string, unknown>;
    const lost = Array.from({ length: 10 }, (_, i) => String(10 + i)).filter((k) => !(k in m3));
    record("10 concurrent per-slide writes: no lost keys", lost.length === 0, lost.length ? `lost ${lost}` : "");

    // Client-supplied slideActions stripped on addServiceItem(s) insert path.
    const stripped = stripClientSlideActions<Record<string, unknown>>({ reference: "x", slideActions: { "0": [{ type: "kill" }] } });
    record("stripClientSlideActions removes client slideActions", !("slideActions" in stripped) && stripped.reference === "x");

    // Read path sanitizes: a direct-DB-corrupted row with a guarded spec + extra keys.
    await db.update(songSlides).set({ actions: [{ type: "kill" }, { ...msg, evil: 1 }] }).where(eq(songSlides.id, A.slide.id));
    await db.update(serviceItems).set({ payload: { ...(afterConc.payload as Record<string, unknown>), slideActions: { "0": [{ type: "blank" }, { ...timer, evil: 2 }] } } }).where(eq(serviceItems.id, A.item.id));
    const [songItem] = await db.insert(serviceItems).values({ servicePlanId: A.plan.id, order: 1, type: "song", title: "Song", payload: { songId: A.song.id } }).returning();
    const expanded = await getExpandedServicePlan(A.plan.id, A.church.id);
    const exItems = (expanded as unknown as { items?: Array<{ id: string; slideActions?: unknown[][] }> })?.items ?? [];
    const exSong = exItems.find((i) => i.id === songItem.id);
    const exScr = exItems.find((i) => i.id === A!.item.id);
    record("getExpandedServicePlan sanitizes song slide actions on read",
      JSON.stringify(exSong?.slideActions?.[0]) === JSON.stringify([msg]), JSON.stringify(exSong?.slideActions));
    record("getExpandedServicePlan sanitizes item slideActions on read",
      JSON.stringify(exScr?.slideActions?.[0]) === JSON.stringify([timer]), JSON.stringify(exScr?.slideActions));
    const bExpanded = await getExpandedServicePlan(A.plan.id, B.church.id);
    record("B cannot expand A's plan", !bExpanded || ((bExpanded as unknown as { items?: unknown[] }).items ?? []).length === 0, bExpanded ? "returned data" : "null");

    // Cap race: parallel creates can never exceed MAX_MACROS_PER_CHURCH.
    const existing = (await listMacrosCore(db, B.church.id)).length;
    const attempts = MAX_MACROS_PER_CHURCH - existing + 15;
    await Promise.all(Array.from({ length: attempts }, (_, i) => createMacroCore(db, B!.church.id, { name: `race ${i}`, actions: [] })));
    const finalCount = (await listMacrosCore(db, B.church.id)).length;
    record("parallel createMacro never exceeds the cap", finalCount === MAX_MACROS_PER_CHURCH, `count=${finalCount} cap=${MAX_MACROS_PER_CHURCH}`);
  } catch (err) {
    record("test harness", false, err instanceof Error ? err.stack ?? err.message : String(err));
  } finally {
    if (A) await cleanup(A.church.id).catch((e) => console.error("cleanup A", e));
    if (B) await cleanup(B.church.id).catch((e) => console.error("cleanup B", e));
  }
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
