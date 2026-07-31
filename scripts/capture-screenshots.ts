/**
 * Marketing screenshot capture — drives Chromium against the hosted app and
 * captures high-quality product screenshots for landing pages / decks / videos.
 *
 * Output: screenshots/ (viewport shots at 1920x1080 + 2560x1440, -full fullPage
 * variants for scrolling pages) and screenshots/crops/ (element crops of the
 * sidebar, AI detections rail, Cmd+K palette, topbar cluster, transcript panel,
 * slide grid, and audio settings popover).
 *
 * Usage:
 *   BASE_URL=https://faithflow-ai.vercel.app \
 *   CAPTURE_EMAIL=demo@example.com CAPTURE_PASSWORD=secret \
 *   npx tsx scripts/capture-screenshots.ts
 *
 * Notes:
 *  - Dark mode is the app default; captured as-is.
 *  - The operator flow fires the first song slide live so /live and /stage
 *    render real content (safe: demo account, /live is just a route render).
 *  - Native audio device picker is Electron-only; browser-mode UI is captured.
 */

import { chromium, type Page, type BrowserContext } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL || "https://faithflow-ai.vercel.app";
const EMAIL = process.env.CAPTURE_EMAIL || "";
const PASSWORD = process.env.CAPTURE_PASSWORD || "";

const OUT = path.join(process.cwd(), "screenshots");
const CROPS = path.join(OUT, "crops");
fs.mkdirSync(CROPS, { recursive: true });

const VIEWPORTS = [
  { label: "1920x1080", width: 1920, height: 1080 },
  { label: "2560x1440", width: 2560, height: 1440 },
] as const;

const SETTLE_MS = 1500;

type RouteSpec = {
  route: string;
  name: string;
  auth: boolean;
  fullPage?: boolean; // also capture a -full fullPage variant
};

// Adjust to the routes that actually exist in src/app/.
const ROUTES: RouteSpec[] = [
  { route: "/login", name: "login", auth: false },
  { route: "/dashboard", name: "dashboard", auth: true, fullPage: true },
  { route: "/services", name: "services", auth: true, fullPage: true },
  { route: "/library/songs", name: "library-songs", auth: true, fullPage: true },
  { route: "/library/bible", name: "library-bible", auth: true },
  { route: "/library/media", name: "library-media", auth: true },
  { route: "/library/themes", name: "library-themes", auth: true },
  { route: "/analytics", name: "analytics", auth: true, fullPage: true },
  { route: "/settings", name: "settings", auth: true, fullPage: true },
  { route: "/settings/team", name: "settings-team", auth: true, fullPage: true },
  { route: "/settings/billing", name: "settings-billing", auth: true, fullPage: true },
  { route: "/operator", name: "operator", auth: true },
];

async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(SETTLE_MS);
}

async function shoot(page: Page, name: string, label: string, fullPage = false) {
  const file = path.join(OUT, `${name}-${label}${fullPage ? "-full" : ""}.png`);
  await page.screenshot({ path: file, fullPage });
  console.log(`  [shot] ${path.basename(file)}`);
}

async function crop(page: Page, selector: string, file: string) {
  const el = page.locator(selector).first();
  try {
    await el.waitFor({ state: "visible", timeout: 8_000 });
    await el.screenshot({ path: path.join(CROPS, file) });
    console.log(`  [crop] ${file}`);
  } catch (e) {
    console.warn(`  [crop-miss] ${file} (${selector}): ${(e as Error).message}`);
  }
}

async function login(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await settle(page);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page
    .waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 })
    .catch(() => {});
  if (page.url().includes("/login")) {
    throw new Error("Login failed — check CAPTURE_EMAIL / CAPTURE_PASSWORD");
  }
  console.log(`  [auth] logged in → ${page.url()}`);
}

async function captureRoutes(context: BrowserContext, authed: boolean) {
  const page = await context.newPage();
  if (authed && EMAIL) await login(page);
  for (const spec of ROUTES) {
    if (spec.auth !== authed) continue;
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      try {
        await page.goto(`${BASE}${spec.route}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await settle(page);
        await shoot(page, spec.name, vp.label);
        if (spec.fullPage && vp.label === "1920x1080") await shoot(page, spec.name, vp.label, true);
      } catch (e) {
        console.warn(`  [route-fail] ${spec.route} @ ${vp.label}: ${(e as Error).message}`);
      }
    }
  }
  await page.close();
}

async function captureOperatorAndLive(context: BrowserContext) {
  const page = await context.newPage();
  await login(page);
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.goto(`${BASE}/operator`, { waitUntil: "domcontentloaded" });
  await settle(page);

  // Click the first song in the plan / library so the slide grid populates.
  const songItem = page
    .locator('[data-testid^="plan-item"], [data-plan-item], aside button, aside [role="button"]')
    .filter({ hasNotText: /^$/ })
    .first();
  try {
    await songItem.click({ timeout: 5_000 });
    await page.waitForTimeout(1200);
  } catch {
    console.warn("  [operator] no clickable plan item found — capturing as-is");
  }
  await shoot(page, "operator-song", "2560x1440");

  // Fire the first slide live so /live and /stage render real content.
  const slide = page.locator('[data-slide-index], [data-testid^="slide-"], .slide-grid button').first();
  try {
    await slide.click({ timeout: 5_000 });
    await page.waitForTimeout(1000);
    console.log("  [operator] fired first slide live");
  } catch {
    console.warn("  [operator] could not fire a slide live");
  }

  // Bible workspace, if switchable via visible UI.
  const bibleTab = page.getByRole("tab", { name: /bible/i }).or(page.getByRole("button", { name: /^bible$/i })).first();
  try {
    await bibleTab.click({ timeout: 4_000 });
    await page.waitForTimeout(1200);
    await shoot(page, "operator-bible", "2560x1440");
  } catch {
    console.warn("  [operator] no visible Bible mode toggle");
  }

  // Live + stage render the fired slide (separate pages, same auth context).
  for (const r of [
    { route: "/live", name: "live" },
    { route: "/stage", name: "stage" },
    { route: "/livestream", name: "livestream" },
  ]) {
    const p2 = await context.newPage();
    for (const vp of VIEWPORTS) {
      await p2.setViewportSize({ width: vp.width, height: vp.height });
      try {
        await p2.goto(`${BASE}${r.route}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await settle(p2);
        await shoot(p2, r.name, vp.label);
      } catch (e) {
        console.warn(`  [route-fail] ${r.route}: ${(e as Error).message}`);
      }
    }
    await p2.close();
  }

  // ---- Marketing crops (real selectors from the DOM) ----
  await page.bringToFront();
  await crop(page, '[data-testid="ai-detections-panel"]', "ai-detections-rail.png");
  await crop(page, '[data-testid="live-transcript-panel"]', "live-transcript-panel.png");
  await crop(page, '[data-testid="ai-transcript-ticker"]', "ai-transcript-ticker.png");

  // Cmd+K palette
  try {
    await page.keyboard.press("Meta+k");
    await page.waitForTimeout(800);
    await crop(page, '[cmdk-root], [role="dialog"]', "command-palette.png");
    await page.keyboard.press("Escape");
  } catch {
    console.warn("  [crop-miss] command palette");
  }

  // Sidebar + topbar cluster live on the app shell (dashboard), not the operator.
  const shellPage = await context.newPage();
  await shellPage.setViewportSize({ width: 1920, height: 1080 });
  await shellPage.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await settle(shellPage);
  await crop(shellPage, "aside, nav[aria-label]", "sidebar-nav.png");
  await crop(shellPage, "header", "topbar-church-badge.png");
  await shellPage.close();

  // Slide grid close-up + audio settings popover from the operator surface.
  await crop(page, '[data-testid="slide-grid"], .grid', "slide-grid-closeup.png");
  const audioBtn = page.getByRole("button", { name: /audio|mic/i }).first();
  try {
    await audioBtn.click({ timeout: 4_000 });
    await page.waitForTimeout(800);
    await crop(page, '[role="dialog"], [data-radix-popper-content-wrapper]', "settings-audio-popover.png");
  } catch {
    console.warn("  [crop-miss] audio popover (may be desktop-only)");
  }

  await page.close();
}

async function main() {
  console.log(`base: ${BASE}`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  try {
    await captureRoutes(context, false);
    if (EMAIL && PASSWORD) {
      await captureRoutes(context, true);
      await captureOperatorAndLive(context);
    } else {
      console.warn("No CAPTURE_EMAIL/CAPTURE_PASSWORD — public pages only.");
    }
  } finally {
    await browser.close();
  }
  console.log(`\nDone. Output: ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
