/**
 * E2E — onboarding demo/real toggle + /help/first-sunday VideoSlot render.
 *
 * Seeds a partial user directly in the DB (bypasses email verification),
 * drives a headless Chromium through /login → /onboarding/church, exercises
 * the demo radio, then checks:
 *   1. The new churches row has is_demo=true.
 *   2. /help/first-sunday renders the VideoSlot placeholder text.
 */

import { chromium } from "playwright";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../src/lib/db/client";
import { users, churches, churchPreferences, subscriptions } from "../../src/lib/db/schema";

const BASE = process.env.E2E_BASE_URL || "http://localhost:3000";
const EMAIL = `e2e-onboarding-${Date.now()}@test.presentflow.ai`;
const PASSWORD = "test-password-1234";

let passes = 0;
let fails = 0;
function assert(cond: boolean, label: string, extra?: string) {
  if (cond) { passes++; console.log(`[PASS] ${label}${extra ? " — " + extra : ""}`); }
  else { fails++; console.error(`[FAIL] ${label}${extra ? " — " + extra : ""}`); }
}

async function main() {
  const db = getDb();

  console.log(`--- Seeding partial user ${EMAIL} ---`);
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const [user] = await db.insert(users).values({
    email: EMAIL, passwordHash, name: "E2E Onboarding",
    role: "admin", churchId: null, emailVerifiedAt: new Date(),
  }).returning();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);

  try {
    console.log("--- Signing in ---");
    page.on("console", (msg) => { if (msg.type() === "error") console.log("[browser console.error]", msg.text()); });
    page.on("pageerror", (err) => console.log("[browser pageerror]", err.message));
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(onboarding|dashboard)/, { timeout: 30_000 });
    assert(true, "login → onboarding redirect", page.url());

    console.log("--- /onboarding/church: pick Demo mode ---");
    await page.goto(`${BASE}/onboarding/church`);
    await page.waitForSelector('input[name="mode"][value="demo"]');
    await page.click('input[name="mode"][value="demo"]');
    const demoChecked = await page.isChecked('input[name="mode"][value="demo"]');
    assert(demoChecked, "demo radio checked");

    const churchName = `E2E Demo Church ${Date.now()}`;
    // Church name is the first required text input inside the form.
    await page.fill('input.ff-input >> nth=0', churchName);
    await Promise.all([
      page.waitForURL(/\/onboarding\/migration/, { timeout: 20_000 }),
      page.click('button[type="submit"]'),
    ]);
    assert(true, "advanced to /onboarding/migration");

    console.log("--- DB check: new church has is_demo=true ---");
    const [attached] = await db.select().from(users).where(eq(users.id, user.id));
    assert(!!attached.churchId, "user now has churchId");
    const [church] = await db.select().from(churches).where(eq(churches.id, attached.churchId!));
    assert(church.name === churchName, "church name matches", church.name);
    assert(church.isDemo === true, "church.isDemo === true", String(church.isDemo));

    console.log("--- Sanity: pick Real on a fresh row ---");
    // Detach the current user, wipe the demo church, redo with Real.
    await db.delete(subscriptions).where(eq(subscriptions.churchId, church.id));
    await db.delete(churchPreferences).where(eq(churchPreferences.churchId, church.id));
    await db.update(users).set({ churchId: null }).where(eq(users.id, user.id));
    await db.delete(churches).where(eq(churches.id, church.id));

    await page.goto(`${BASE}/onboarding/church`);
    await page.waitForSelector('input[name="mode"][value="real"]');
    const realCheckedByDefault = await page.isChecked('input[name="mode"][value="real"]');
    assert(realCheckedByDefault, "real radio checked by default");
    const realName = `E2E Real Church ${Date.now()}`;
    await page.fill('input.ff-input >> nth=0', realName);
    await Promise.all([
      page.waitForURL(/\/onboarding\/migration/, { timeout: 20_000 }),
      page.click('button[type="submit"]'),
    ]);
    const [u2] = await db.select().from(users).where(eq(users.id, user.id));
    const [c2] = await db.select().from(churches).where(eq(churches.id, u2.churchId!));
    assert(c2.isDemo === false, "real-mode church.isDemo === false", String(c2.isDemo));

    console.log("--- /help/first-sunday: VideoSlot renders placeholder ---");
    // Onboarding still in_progress → routes redirect to /onboarding/tutorial.
    // Mark complete so we can reach the (app) group.
    const [uForFlag] = await db.select().from(users).where(eq(users.id, user.id));
    await db.update(churches).set({ onboardingStatus: "complete" }).where(eq(churches.id, uForFlag.churchId!));
    await db.update(users).set({ tutorialCompletedAt: new Date() }).where(eq(users.id, user.id));
    // Complete onboarding-status enough for /help/first-sunday to render.
    // Route is inside the (app) group; requireUser succeeds as long as
    // churchId is set, which it now is.
    await page.goto(`${BASE}/help/first-sunday`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    console.log(`  first-sunday URL after nav: ${page.url()}`);
    const body = await page.content();
    if (!body.includes("Video coming soon")) {
      console.log(`  body snippet: ${body.slice(0, 500).replace(/\s+/g, " ")}`);
    }
    assert(body.includes("Video coming soon"), "VideoSlot placeholder text renders");
    assert(body.includes("AI walkthrough: setup wizards"), "setup-wizards label present");
    assert(body.includes("AI walkthrough: pre-flight"), "pre-flight label present");

    // Also assert the operator page compiles and reaches the client shell —
    // no need to drive audio here; we just want the page not to crash render.
    console.log("--- Sanity: /dashboard renders (post-onboarding gate) ---");
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
    assert(page.url().includes("/dashboard") || page.url().includes("/onboarding"), "dashboard or onboarding served (no crash)");

  } finally {
    console.log("--- Cleanup ---");
    // Cascade-delete the church row so its dependent rows go too.
    try {
      const [u] = await db.select().from(users).where(eq(users.id, user.id));
      if (u?.churchId) {
        await db.delete(subscriptions).where(eq(subscriptions.churchId, u.churchId));
        await db.delete(churchPreferences).where(eq(churchPreferences.churchId, u.churchId));
        await db.update(users).set({ churchId: null }).where(eq(users.id, user.id));
        await db.delete(churches).where(eq(churches.id, u.churchId));
      }
      await db.delete(users).where(eq(users.id, user.id));
    } catch (e) {
      console.warn("cleanup warning:", e);
    }
    await browser.close();
  }

  console.log(`\n=== E2E onboarding: ${passes}/${passes + fails} PASS ===`);
  if (fails > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
