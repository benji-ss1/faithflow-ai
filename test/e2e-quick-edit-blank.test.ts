/**
 * E2E — Quick edit works on a BLANK slide (Add slide → Quick Edit → type → save → send live).
 *
 * LOCAL ONLY: requires `next dev` with DEV_AUTOLOGIN=1 against a LOCAL database.
 * Run: E2E_BASE_URL=http://localhost:3124 npx tsx --env-file=.env.local test/e2e-quick-edit-blank.test.ts
 *
 * Seeds a uniquely-titled song (2 styled slides) into today's plan for the dev
 * login church, drives the desktop operator shell, then deletes what it created.
 */
import { chromium, type Page } from "playwright";
import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "../src/lib/db/client";
import { users, churches, servicePlans, serviceItems, songs, songSlides } from "../src/lib/db/schema";
import { getTodayInChurchTz } from "../src/lib/dates";

const BASE = process.env.E2E_BASE_URL || "http://localhost:3124";
const EMAIL = process.env.DEV_LOGIN_EMAIL || "";
if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || "")) {
  console.error("Refusing to run: DATABASE_URL is not local."); process.exit(2);
}

let passes = 0, fails = 0;
function assert(cond: boolean, label: string, extra?: string) {
  if (cond) { passes++; console.log(`[PASS] ${label}${extra ? " — " + extra : ""}`); }
  else { fails++; console.error(`[FAIL] ${label}${extra ? " — " + extra : ""}`); }
}
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const styledObj = (text: string) => ({ kind: "text", x: 80, y: 400, w: 1760, h: 280, text, fontFamily: "Georgia", fontSize: 96, fontWeight: 700, color: "#ffd700", align: "center" });

async function liveText(live: Page) { return norm(await live.locator("body").innerText().catch(() => "")); }

async function main() {
  const db = getDb();
  const [u] = await db.select({ churchId: users.churchId }).from(users).where(eq(users.email, EMAIL));
  if (!u?.churchId) throw new Error(`dev login user ${EMAIL} has no church in local DB`);
  const churchId = u.churchId;
  const [ch] = await db.select({ tz: churches.timezone }).from(churches).where(eq(churches.id, churchId));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ extraHTTPHeaders: { "x-pf-shell": "desktop" }, viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on("pageerror", (err) => console.log("[pageerror]", err.message.slice(0, 300)));
  page.on("console", (msg) => { if (msg.type() === "error") console.log("[console.error]", msg.text().slice(0, 300)); });

  const TITLE = `E2E QuickEdit ${Date.now()}`;
  let songId: string | undefined;
  let itemId: string | undefined;
  try {
    // First visit logs in (dev-login) and guarantees today's plan exists.
    await page.goto(`${BASE}/operator?ff_shell=desktop`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/operator/, { timeout: 90_000 });
    const today = getTodayInChurchTz(ch?.tz);
    const [plan] = await db.select({ id: servicePlans.id }).from(servicePlans)
      .where(and(eq(servicePlans.churchId, churchId), eq(servicePlans.scheduledFor, today))).orderBy(asc(servicePlans.id)).limit(1);
    if (!plan) throw new Error("no plan for today after loading /operator");

    const [song] = await db.insert(songs).values({ churchId, title: TITLE }).returning({ id: songs.id });
    songId = song.id;
    await db.insert(songSlides).values([
      { songId, order: 0, lyrics: "First line here", objectsJson: { objects: [styledObj("First line here")] } },
      { songId, order: 1, lyrics: "Second line here", objectsJson: { objects: [styledObj("Second line here")] } },
    ]);
    const [it] = await db.insert(serviceItems).values({ servicePlanId: plan.id, order: -1, type: "song", title: TITLE, payload: { songId } }).returning({ id: serviceItems.id });
    itemId = it.id;

    const live = await context.newPage();
    await live.goto(`${BASE}/live`, { waitUntil: "domcontentloaded" });

    // a/b. Open operator, load the song, Add slide.
    await page.goto(`${BASE}/operator?ff_shell=desktop`, { waitUntil: "domcontentloaded" });
    await page.getByText(TITLE, { exact: true }).first().click();
    await page.locator('[role="gridcell"]').nth(1).waitFor();
    const before = await page.locator('[role="gridcell"]').count();
    console.log(`gridcells before Add slide: ${before}`);
    // The header button is server-rendered, so an early click can land before
    // hydration attaches the handler. Retry until the row exists (max 3 clicks).
    let added = false;
    for (let attempt = 0; attempt < 3 && !added; attempt++) {
      await page.getByRole("button", { name: /Add slide/ }).click();
      for (let i = 0; i < 12; i++) {
        const n = (await db.select({ id: songSlides.id }).from(songSlides).where(eq(songSlides.songId, songId))).length;
        if (n >= 3) { added = true; console.log(`DB has ${n} slides (click attempt ${attempt + 1}, ${i * 500}ms)`); break; }
        await page.waitForTimeout(500);
      }
    }
    console.log(`gridcells after DB poll: ${await page.locator('[role="gridcell"]').count()}`);
    await page.waitForFunction((n) => document.querySelectorAll('[role="gridcell"]').length === n + 1, before, { timeout: 30_000 });
    assert(true, "Add slide appended a card", `${before} → ${before + 1}`);
    const rows = await db.select().from(songSlides).where(eq(songSlides.songId, songId)).orderBy(asc(songSlides.order));
    const blank = rows[rows.length - 1];
    assert(rows.length === 3 && blank.lyrics === "", "blank slide row created (empty lyrics)");

    const liveBefore = await liveText(live);
    await page.locator('[role="gridcell"]').last().click({ button: "right" });
    await page.getByRole("menuitem", { name: /Quick Edit/ }).click();

    // c. Editable node focused; typing does not touch live or jump slides.
    await page.waitForFunction(() => (document.activeElement as HTMLElement | null)?.isContentEditable === true, null, { timeout: 10_000 }).catch(async (e) => {
      const dump = await page.evaluate(() => ({
        active: document.activeElement?.outerHTML.slice(0, 200),
        dialog: document.querySelector('[role="dialog"][aria-label^="Quick Edit"]')?.outerHTML.slice(0, 2500),
      }));
      console.log("[debug]", JSON.stringify(dump, null, 1));
      throw e;
    });
    const box = await page.evaluate(() => { const r = (document.activeElement as HTMLElement).getBoundingClientRect(); return { w: r.width, h: r.height }; });
    assert(box.w > 0 && box.h > 0, "empty editable node is focused with a real caret box", `${Math.round(box.w)}x${Math.round(box.h)}`);
    const selBefore = await page.evaluate(() => Array.from(document.querySelectorAll('[role="gridcell"]')).findIndex((el) => el.querySelector(".pf-selected-glow") || el.classList.contains("pf-selected-glow") || el.closest(".pf-selected-glow")));
    await page.keyboard.type("Hello world 123 g");
    const typed = await page.evaluate(() => (document.activeElement as HTMLElement).innerText);
    assert(typed === "Hello world 123 g", "typed text (space, 1, g) landed in the slide", JSON.stringify(typed));
    assert((await liveText(live)) === liveBefore, "live output unchanged while typing");
    const selAfter = await page.evaluate(() => Array.from(document.querySelectorAll('[role="gridcell"]')).findIndex((el) => el.querySelector(".pf-selected-glow") || el.classList.contains("pf-selected-glow") || el.closest(".pf-selected-glow")));
    assert(selAfter === selBefore, "no slide selection jump while typing");

    // d. Cmd/Ctrl+Enter saves.
    await page.keyboard.press("ControlOrMeta+Enter");
    await page.getByText("Slide updated").first().waitFor({ timeout: 15_000 });
    assert(true, "toast 'Slide updated' shown");
    const [saved] = await db.select().from(songSlides).where(eq(songSlides.id, blank.id));
    const objs = (saved.objectsJson as { objects?: Array<Record<string, unknown>> } | null)?.objects ?? [];
    assert(saved.lyrics === "Hello world 123 g", "DB lyrics updated", JSON.stringify(saved.lyrics));
    assert(objs.length === 1 && objs[0].text === "Hello world 123 g" && objs[0].fontFamily === "Georgia" && objs[0].color === "#ffd700", "DB objectsJson text swapped, styling kept", JSON.stringify(objs[0] ?? null));

    // e. Send this slide live.
    await page.getByRole("button", { name: "Send this slide live" }).click();
    await live.waitForFunction(() => /hello world 123 g/i.test(document.body.innerText), null, { timeout: 15_000 }).then(() => assert(true, "/live shows the typed text")).catch(async () => assert(false, "/live shows the typed text", await liveText(live)));

    // g. Escape closes the panel without clearing live.
    await page.keyboard.press("Escape");
    await page.locator('[role="dialog"][aria-label^="Quick Edit"]').waitFor({ state: "detached", timeout: 5_000 }).then(() => assert(true, "Escape closed the Quick Edit panel")).catch(() => assert(false, "Escape closed the Quick Edit panel"));
    await page.waitForTimeout(1200);
    assert(/hello world 123 g/.test(await liveText(live)), "live NOT cleared by Escape");

    // f. Quick edit on an existing filled slide still works.
    await page.locator('[role="gridcell"]').first().click({ button: "right" });
    await page.getByRole("menuitem", { name: /Quick Edit/ }).click();
    await page.waitForFunction(() => (document.activeElement as HTMLElement | null)?.innerText === "First line here", null, { timeout: 10_000 });
    assert(true, "filled slide opens focused with its text");
    await page.keyboard.type(" edited");
    await page.keyboard.press("ControlOrMeta+Enter");
    await page.waitForFunction(async () => true);
    await page.waitForTimeout(2500);
    const [first] = await db.select().from(songSlides).where(eq(songSlides.id, rows[0].id));
    assert(first.lyrics === "First line here edited", "filled slide save persisted", JSON.stringify(first.lyrics));
    await page.keyboard.press("Escape");
    await page.locator('[role="dialog"][aria-label^="Quick Edit"]').waitFor({ state: "detached", timeout: 5_000 });
    assert(true, "Escape after a save closes without a discard prompt");

    // h. Unsaved typing → "Send this slide live" SAVES first, then projects.
    await page.locator('[role="gridcell"]').nth(1).click({ button: "right" });
    await page.getByRole("menuitem", { name: /Quick Edit/ }).click();
    await page.waitForFunction(() => (document.activeElement as HTMLElement | null)?.innerText === "Second line here", null, { timeout: 10_000 });
    await page.keyboard.type(" sent");
    await page.getByRole("button", { name: "Send this slide live" }).click();
    await live.waitForFunction(() => /second line here sent/i.test(document.body.innerText), null, { timeout: 15_000 })
      .then(() => assert(true, "send-live with unsaved text: /live shows it"))
      .catch(async () => assert(false, "send-live with unsaved text: /live shows it", await liveText(live)));
    const [second] = await db.select().from(songSlides).where(eq(songSlides.id, rows[1].id));
    assert(second.lyrics === "Second line here sent", "send-live with unsaved text: DB saved first", JSON.stringify(second.lyrics));
    await page.keyboard.press("Escape");
    await page.locator('[role="dialog"][aria-label^="Quick Edit"]').waitFor({ state: "detached", timeout: 5_000 })
      .then(() => assert(true, "closed after send-live (nothing unsaved → no prompt)"))
      .catch(() => assert(false, "closed after send-live (nothing unsaved → no prompt)"));

    // i. Unsaved typing → Esc → confirm appears; dismiss → still editing.
    await page.locator('[role="gridcell"]').nth(1).click({ button: "right" });
    await page.getByRole("menuitem", { name: /Quick Edit/ }).click();
    await page.waitForFunction(() => (document.activeElement as HTMLElement | null)?.isContentEditable === true, null, { timeout: 10_000 });
    await page.keyboard.type(" draft");
    await page.keyboard.press("Escape");
    const confirmBox = page.getByRole("alertdialog");
    await confirmBox.waitFor({ timeout: 5_000 }).then(() => assert(true, "Esc with unsaved text shows 'Discard unsaved changes?'")).catch(() => assert(false, "Esc with unsaved text shows 'Discard unsaved changes?'"));
    assert(/Discard unsaved changes\?/.test(await confirmBox.innerText().catch(() => "")), "confirm dialog title");
    await confirmBox.getByRole("button", { name: /cancel/i }).click();
    await page.waitForTimeout(400);
    assert(await page.locator('[role="dialog"][aria-label^="Quick Edit"]').count() === 1, "dismissing the confirm keeps the Quick Edit panel open");
    const stillText = await page.locator('[role="dialog"][aria-label^="Quick Edit"] [contenteditable]').innerText();
    assert(/second line here sent draft/i.test(stillText), "typed draft preserved after dismiss", JSON.stringify(stillText));
    assert(/second line here sent/.test(await liveText(live)), "live untouched by Esc/confirm");
    // Discard to finish; DB must keep the saved (not draft) text.
    await page.locator('[role="dialog"][aria-label="Close"], [aria-label="Close"]').first().click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Discard" }).click();
    await page.locator('[role="dialog"][aria-label^="Quick Edit"]').waitFor({ state: "detached", timeout: 5_000 });
    const [afterDiscard] = await db.select().from(songSlides).where(eq(songSlides.id, rows[1].id));
    assert(afterDiscard.lyrics === "Second line here sent", "✕ + Discard closes without saving the draft");
  } catch (e) {
    fails++; console.error("[FAIL] exception:", (e as Error).message);
    await page.screenshot({ path: process.env.E2E_SCREENSHOT || "e2e-quick-edit-fail.png" }).catch(() => {});
  } finally {
    if (itemId) await db.delete(serviceItems).where(eq(serviceItems.id, itemId));
    if (songId) { await db.delete(songSlides).where(eq(songSlides.songId, songId)); await db.delete(songs).where(eq(songs.id, songId)).catch((err) => console.log("song delete:", err.message)); }
    const [left] = await db.select({ n: sql<number>`count(*)::int` }).from(songs).where(eq(songs.title, TITLE));
    console.log(`cleanup: remaining test songs = ${left?.n ?? "?"}`);
    await browser.close();
  }
  console.log(`\nE2E quick-edit blank: ${passes} passed, ${fails} failed`);
  process.exit(fails > 0 ? 1 : 0);
}
main();
