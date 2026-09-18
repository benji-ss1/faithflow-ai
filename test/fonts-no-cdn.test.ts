/**
 * Fonts P1 — no runtime font CDN. Slide fonts must be self-hosted so outputs work
 * offline and under the (planned) enforcing CSP `font-src 'self' data:`.
 * Run: npx tsx test/fonts-no-cdn.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name} — ${(e as Error).message}`); fail++; }
}
function walk(dir: string, out: string[] = []): string[] {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p, out);
    else if (/\.(css|tsx?|html)$/.test(d.name)) out.push(p);
  }
  return out;
}
const CDN = /fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|fonts\.bunny\.net|cdn\.jsdelivr\.net\/(npm\/)?@?fontsource/;

check("no font CDN reference anywhere in src/ (code, not comments)", () => {
  const hits: string[] = [];
  for (const f of walk(path.join(ROOT, "src"))) {
    const src = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    if (CDN.test(src)) hits.push(path.relative(ROOT, f));
  }
  assert.deepEqual(hits, []);
});
check("globals.css has no @import url(...) (would be dropped after the Tailwind expansion)", () => {
  const css = fs.readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
  assert.ok(!/@import\s+url\(/.test(css));
});
check("public/fonts css urls are same-origin", () => {
  const css = fs.readFileSync(path.join(ROOT, "src/app/slide-fonts.css"), "utf8");
  for (const m of css.matchAll(/url\("([^"]+)"\)/g)) assert.ok(m[1].startsWith("/fonts/"), m[1]);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
