/**
 * Playwright: signs in as demo@jpd.faithflow.ai on prod, walks a handful of
 * post-onboarding routes to prove nothing 500s. Uses the password just reset
 * (passed via VICTOR_PW env var — don't hardcode).
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL || "https://faithflow-ai.vercel.app";
const EMAIL = "demo@jpd.faithflow.ai";
const PW: string = process.env.VICTOR_PASSWORD ?? "";
if (!PW) { console.error("VICTOR_PASSWORD env var required"); process.exit(1); }

const OUT_DIR = path.join(process.cwd(), "test/screenshots/victor-" + Date.now());
fs.mkdirSync(OUT_DIR, { recursive: true });

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push("[pageerror] " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("[console] " + m.text()); });

  const shot = async (label: string) => {
    const f = path.join(OUT_DIR, `${label.replace(/[^a-z0-9]+/gi, "-")}.png`);
    await page.screenshot({ path: f, fullPage: true });
    console.log(`  ${label} → ${page.url()}`);
  };

  try {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PW);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(dashboard|onboarding|services)/, { timeout: 30_000 });
    await shot("00-landing");
    console.log(`login landing: ${page.url()}`);

    for (const r of ["/dashboard","/services","/library/songs","/library/bible","/practice","/setup/diagnostics","/help/first-sunday","/settings/devices"]) {
      const resp = await page.goto(`${BASE}${r}`, { waitUntil: "domcontentloaded" });
      const status = resp?.status() ?? 0;
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(()=>{});
      const badge = status >= 500 ? "❌" : status >= 400 ? "⚠️" : "✓";
      console.log(`  ${badge} ${status}  ${r}`);
      await shot(`${status}-${r.replace(/\//g, "-").slice(1)}`);
    }
  } finally {
    await browser.close();
  }

  console.log(`screenshots: ${OUT_DIR}`);
  if (errors.length) {
    console.log(`\nERRORS (${errors.length}):`);
    for (const e of errors.slice(0, 20)) console.log("  " + e);
    process.exit(1);
  }
  console.log("\n✓ Victor's login flow: no runtime errors");
}
main().catch((e) => { console.error(e); process.exit(1); });
