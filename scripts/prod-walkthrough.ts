/**
 * Prod walkthrough — drives a real Chromium against the live URL, walks every
 * post-onboarding route Victor is likely to touch, and screenshots each state
 * to test/screenshots/. Signs up a fresh account so the run is self-contained
 * (no seed dependency). The signup gets rate-limited (5/hr per IP) — don't spam.
 *
 * Usage:
 *   BASE_URL=https://presentflow.app npx tsx scripts/prod-walkthrough.ts
 *   (default BASE_URL is the prod alias)
 *
 * Optional: SEED_LOGIN=email:password to skip signup and use an existing acct.
 */

import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL || "https://presentflow.app";
const OUT_DIR = path.join(process.cwd(), "test/screenshots", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(OUT_DIR, { recursive: true });

let step = 0;
async function shot(page: Page, label: string) {
  step++;
  const file = path.join(OUT_DIR, `${String(step).padStart(2, "0")}-${label.replace(/[^a-z0-9]+/gi, "-")}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`  [shot] ${step} → ${label} (${page.url()})`);
}

async function main() {
  const email = `walkthrough-${Date.now()}@e2e.presentflow.ai`;
  const password = "walkthrough-pw-1234!";
  const name = "E2E Walkthrough";
  console.log(`base URL: ${BASE}`);
  console.log(`test account: ${email}`);
  console.log(`output dir: ${OUT_DIR}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);

  const errors: string[] = [];
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(`[console] ${msg.text()}`); });
  page.on("pageerror", (err) => errors.push(`[pageerror] ${err.message}`));

  try {
    // --- Signup or seeded login ---
    if (process.env.SEED_LOGIN) {
      const [e, p] = process.env.SEED_LOGIN.split(":");
      await page.goto(`${BASE}/login`);
      await shot(page, "login");
      await page.fill('input[type="email"]', e);
      await page.fill('input[type="password"]', p);
      await page.click('button[type="submit"]');
    } else {
      await page.goto(`${BASE}/signup`);
      await shot(page, "signup");
      await page.fill('input[autocomplete="name"]', name);
      await page.fill('input[type="email"]', email);
      await page.fill('input[type="password"]', password);
      await page.click('button[type="submit"]');
    }
    await page.waitForURL(/\/onboarding/, { timeout: 30_000 });
    await shot(page, "onboarding-landing");

    // --- Onboarding: church details ---
    if (!page.url().includes("/onboarding/church")) {
      await page.goto(`${BASE}/onboarding/church`);
    }
    await page.waitForSelector('input[name="mode"][value="demo"]');
    await shot(page, "onboarding-church-form");
    await page.click('input[name="mode"][value="demo"]');
    await shot(page, "onboarding-church-demo-selected");
    await page.fill('input.ff-input >> nth=0', `E2E Church ${Date.now()}`);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/onboarding\//, { timeout: 30_000 });
    await shot(page, "onboarding-migration");

    // Skip through migration
    const skipMig = await page.$('a:has-text("Skip"), button:has-text("Skip")');
    if (skipMig) { await skipMig.click(); }
    await page.waitForLoadState("domcontentloaded");
    await shot(page, "post-migration");

    // Complete onboarding tutorial step if landed there
    if (page.url().includes("/onboarding/tutorial")) {
      await shot(page, "onboarding-tutorial");
      const done = await page.$('button:has-text("Complete"), button:has-text("Finish"), button:has-text("Continue")');
      if (done) await done.click();
      await page.waitForLoadState("domcontentloaded");
    }

    // --- Walk every important app route ---
    const routes = [
      "/dashboard",
      "/services",
      "/library/songs",
      "/library/bible",
      "/library/media",
      "/library/imports",
      "/practice",
      "/setup/audio",
      "/setup/projector",
      "/setup/diagnostics",
      "/help/first-sunday",
      "/tutorial",
      "/settings",
      "/settings/devices",
      "/settings/team",
      "/settings/billing",
    ];
    for (const r of routes) {
      try {
        await page.goto(`${BASE}${r}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
        await shot(page, `route${r.replace(/\//g, "-")}`);
      } catch (e) {
        console.warn(`  route ${r} failed: ${(e as Error).message}`);
        errors.push(`[route-fail] ${r}: ${(e as Error).message}`);
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`\n=== Walkthrough complete ===`);
  console.log(`Screenshots: ${OUT_DIR}`);
  if (errors.length) {
    console.log(`\nRuntime errors observed (${errors.length}):`);
    for (const e of errors.slice(0, 30)) console.log(`  ${e}`);
    process.exit(1);
  }
  console.log(`No runtime errors observed.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
