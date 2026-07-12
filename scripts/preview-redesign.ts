/**
 * Playwright: opens login/signup/forgot-password + drives onboarding on
 * localhost, screenshots each state so we can spot-check the redesign.
 * Also seeds a temporary partial user so /onboarding renders (needs a
 * verified email + null churchId).
 */
import { chromium } from "playwright";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../src/lib/db/client";
import { users, churches, churchPreferences, subscriptions } from "../src/lib/db/schema";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT_DIR = path.join(process.cwd(), "test/screenshots/redesign-" + Date.now());
fs.mkdirSync(OUT_DIR, { recursive: true });

const EMAIL = `redesign-${Date.now()}@e2e.presentflow.ai`;
const PW = "redesign-pw-1234!";

async function main() {
  const db = getDb();
  const passwordHash = await bcrypt.hash(PW, 12);
  const [user] = await db
    .insert(users)
    .values({ email: EMAIL, passwordHash, name: "Redesign Test", role: "admin", churchId: null, emailVerifiedAt: new Date() })
    .returning();

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20_000);

  const shot = async (label: string) => {
    await page.screenshot({ path: path.join(OUT_DIR, `${label}.png`), fullPage: true });
    console.log(`  ${label} → ${page.url()}`);
  };

  try {
    // Public auth screens
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await shot("01-login");
    await page.goto(`${BASE}/signup`, { waitUntil: "networkidle" });
    await shot("02-signup");
    await page.goto(`${BASE}/forgot-password`, { waitUntil: "networkidle" });
    await shot("03-forgot");

    // Sign in and drive the wizard
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PW);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/onboarding/, { timeout: 30_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    await shot("04-onboarding-step-0");

    await page.fill('input[placeholder="Grace Community Church"]', "PresentFlow QA Workspace");
    await page.click('button:has-text("Continue")');
    await page.waitForLoadState("networkidle").catch(() => {});
    await shot("05-onboarding-step-1");

    // Pick a use case (Business)
    await page.click('button:has-text("Business & Teams")');
    await shot("05b-onboarding-step-1-selected");
    await page.click('button:has-text("Continue")');
    await page.waitForLoadState("networkidle").catch(() => {});
    await shot("06-onboarding-step-2");

    // Add an invite
    await page.fill('input[placeholder="teammate@example.com"]', "invitee@example.com");
    await page.click('button:has-text("Add")');
    await shot("06b-invite-added");
    await page.click('button:has-text("Finish setup")');
    await page.waitForLoadState("networkidle").catch(() => {});
    await shot("07-onboarding-step-3");
    await page.click('button:has-text("Enter PresentFlow")');
    await page.waitForURL(/\/dashboard|\/onboarding/, { timeout: 30_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    await shot("08-dashboard");

    // A couple more themed routes
    for (const r of ["/library/songs", "/settings", "/help/first-sunday"]) {
      await page.goto(`${BASE}${r}`, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => {});
      await shot(`09-route-${r.replace(/\//g, "-").slice(1)}`);
    }
  } finally {
    // Cleanup — cascade delete the seeded user + church
    try {
      const [u] = await db.select().from(users).where(eq(users.id, user.id));
      if (u?.churchId) {
        await db.delete(subscriptions).where(eq(subscriptions.churchId, u.churchId));
        await db.delete(churchPreferences).where(eq(churchPreferences.churchId, u.churchId));
        await db.update(users).set({ churchId: null }).where(eq(users.id, user.id));
        await db.delete(churches).where(eq(churches.id, u.churchId));
      }
      await db.delete(users).where(eq(users.id, user.id));
    } catch {}
    await browser.close();
  }
  console.log(`\nScreenshots: ${OUT_DIR}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
