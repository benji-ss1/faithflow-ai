#!/usr/bin/env node
/**
 * Fonts P1 stress test — proves every bundled slide font actually RENDERS its
 * real face (not a fallback) in a real browser, for every weight and style the
 * pickers offer.
 *
 * For each font x weight x {normal, italic}:
 *   1. document.fonts.load(spec, sample)  → then assert document.fonts.check(spec) === true
 *   2. canvas measureText width with the real family vs the SAME generic
 *      fallback stack alone — they must differ (the classic fallback-detection
 *      trick: if the face never loaded the two widths are identical).
 *   3. Yoruba/Igbo sample width check for the faces the registry claims support.
 *
 * Starts `next dev` on a free port IN THIS WORKTREE and tears it down after.
 * Usage: node scripts/fonts/stress.mjs [--headed] [--port N] [--base URL]
 */
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const arg = (k) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : undefined;
};
const HEADED = argv.includes("--headed");
const EXTERNAL_BASE = arg("--base");

const LATIN = "Handgloves WMwm 0123 Amazing grace how sweet the sound";
const YORUBA = "Ẹ ẹ Ọ ọ Ṣ ṣ à á è é ì í ò ó ù ú ń";
const IGBO = "Ị ị Ụ ụ Ṅ ṅ Ọ ọ";

async function freePort() {
  return await new Promise((res, rej) => {
    const s = net.createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });
}

async function waitForServer(url, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { redirect: "manual" });
      if (r.status > 0) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  const { chromium } = await import("playwright");
  const { FONT_REGISTRY } = await import("../../src/lib/fonts/registry.ts").catch(() => ({}));
  // registry.ts is TS; load it through tsx's loader if the direct import failed.
  const registry = FONT_REGISTRY ?? (await loadRegistryViaTsx());

  let base = EXTERNAL_BASE;
  let dev = null;
  if (!base) {
    const port = Number(arg("--port")) || (await freePort());
    base = `http://127.0.0.1:${port}`;
    console.log(`[stress] starting next dev on ${base} (cwd ${ROOT})`);
    dev = spawn("npx", ["next", "dev", "-p", String(port)], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    });
    dev.stdout.on("data", (b) => process.env.STRESS_VERBOSE && process.stdout.write(`[dev] ${b}`));
    dev.stderr.on("data", (b) => process.env.STRESS_VERBOSE && process.stderr.write(`[dev] ${b}`));
    if (!(await waitForServer(base))) {
      dev.kill("SIGTERM");
      throw new Error("next dev did not come up");
    }
  }

  const browser = await chromium.launch({ headless: !HEADED });
  const results = [];
  try {
    const page = await browser.newPage();
    // Any app route pulls the root layout, which imports src/app/slide-fonts.css.
    const resp = await page.goto(`${base}/login`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    console.log(`[stress] loaded /login → ${resp?.status()}`);
    // First compile can take a while; give the CSS a beat to attach.
    await page.waitForTimeout(1500);

    const bundled = registry.filter((f) => f.bundled);
    const cases = [];
    for (const f of bundled) {
      for (const w of f.weights) {
        cases.push({ id: f.id, family: f.family, generic: f.generic, weight: w, italic: false, supports: f.supports });
        if (f.italic) cases.push({ id: f.id, family: f.family, generic: f.generic, weight: w, italic: true, supports: f.supports });
      }
    }
    console.log(`[stress] ${bundled.length} bundled families, ${cases.length} face cases`);

    const out = await page.evaluate(
      async ({ cases, LATIN, YORUBA, IGBO }) => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const width = (font, text) => {
          ctx.font = font;
          return ctx.measureText(text).width;
        };
        const res = [];
        for (const c of cases) {
          const style = c.italic ? "italic " : "";
          const spec = `${style}${c.weight} 64px "${c.family}"`;
          const fallbackSpec = `${style}${c.weight} 64px ${c.generic}`;
          let loadErr = null;
          try {
            await document.fonts.load(spec, LATIN);
          } catch (e) {
            loadErr = String(e);
          }
          let checked = document.fonts.check(spec, LATIN);
          if (!checked) {
            // Under `next dev` the first request for a face can still be in
            // flight when load() settles. Give it one honest retry before
            // calling it a failure (a genuinely missing face never passes).
            try {
              await document.fonts.ready;
              await document.fonts.load(spec, LATIN);
              await new Promise((r) => setTimeout(r, 250));
            } catch (e) {
              loadErr = String(e);
            }
            checked = document.fonts.check(spec, LATIN);
          }
          const wReal = width(spec, LATIN);
          const wFallback = width(fallbackSpec, LATIN);
          const entry = {
            id: c.id,
            family: c.family,
            weight: c.weight,
            italic: c.italic,
            checked,
            loadErr,
            wReal,
            wFallback,
            distinct: Math.abs(wReal - wFallback) > 0.5,
          };
          if (c.supports?.yoruba) {
            entry.yorubaDistinct = Math.abs(width(spec, YORUBA) - width(fallbackSpec, YORUBA)) > 0.5;
          }
          if (c.supports?.igbo) {
            entry.igboDistinct = Math.abs(width(spec, IGBO) - width(fallbackSpec, IGBO)) > 0.5;
          }
          res.push(entry);
        }
        return res;
      },
      { cases, LATIN, YORUBA, IGBO },
    );
    results.push(...out);
  } finally {
    await browser.close();
    if (dev) dev.kill("SIGTERM");
  }

  const fails = results.filter((r) => !r.checked || !r.distinct);
  const scriptFails = results.filter((r) => r.yorubaDistinct === false || r.igboDistinct === false);
  const byFamily = new Map();
  for (const r of results) {
    const k = r.family;
    byFamily.set(k, (byFamily.get(k) ?? 0) + 1);
  }
  console.log("\n=== Fonts stress results ===");
  for (const [fam, n] of byFamily) {
    const bad = results.filter((r) => r.family === fam && (!r.checked || !r.distinct));
    console.log(`${bad.length === 0 ? "PASS" : "FAIL"}  ${fam}: ${n - bad.length}/${n} faces render the real face`);
    for (const b of bad) console.log(`        ✗ ${b.weight}${b.italic ? " italic" : ""} check=${b.checked} wReal=${b.wReal.toFixed(1)} wFallback=${b.wFallback.toFixed(1)} ${b.loadErr ?? ""}`);
  }
  for (const s of scriptFails) console.log(`FAIL  ${s.family} ${s.weight}${s.italic ? " italic" : ""}: African-script sample matched the fallback width`);
  console.log(`\n${results.length - fails.length}/${results.length} faces passed; ${scriptFails.length} script-coverage failures`);
  process.exit(fails.length + scriptFails.length === 0 ? 0 : 1);
}

async function loadRegistryViaTsx() {
  const { execFileSync } = await import("node:child_process");
  const json = execFileSync(
    "npx",
    ["tsx", "-e", 'import { FONT_REGISTRY } from "./src/lib/fonts/registry"; console.log(JSON.stringify(FONT_REGISTRY));'],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 8 << 20 },
  );
  return JSON.parse(json.trim().split("\n").pop());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
