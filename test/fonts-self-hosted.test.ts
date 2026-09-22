/**
 * Fonts must not be fetched from Google at build time.
 * Run: npx tsx --test test/fonts-self-hosted.test.ts
 *
 * 2026-09-22: three production builds failed in one afternoon with
 *
 *   An error occurred in `next/font`.
 *   TypeError: Cannot read properties of null (reading '1')
 *   at .../@next/font/dist/google/loader.js:122:78
 *
 * That line is `/\.(woff|woff2|eot|ttf|otf)$/.exec(googleFontFileUrl)[1]` with
 * no null check, so an unexpected Google response kills the build with a
 * message naming neither the font nor the cause. ~25% of builds, entirely
 * outside our control, blocking merges that had nothing to do with fonts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test("nothing imports next/font/google", () => {
  const offenders = walk("src")
    .filter((p) => /\.(ts|tsx)$/.test(p))
    .filter((p) => /from\s+["']next\/font\/google["']/.test(readFileSync(p, "utf8")));
  assert.deepEqual(offenders, [],
    `these fetch fonts from Google at BUILD time, which fails ~25% of builds:\n  ${offenders.join("\n  ")}`);
});

test("every declared face has its file committed", () => {
  const src = readFileSync("src/lib/fonts.ts", "utf8");
  const paths = [...src.matchAll(/path:\s*"\.\.\/fonts\/([^"]+)"/g)].map((m) => m[1]);
  assert.ok(paths.length >= 10, `expected the full set, found ${paths.length}`);
  const have = new Set(readdirSync("src/fonts"));
  for (const f of paths) {
    assert.ok(have.has(f), `src/lib/fonts.ts references ${f}, which is not in src/fonts — the build will fail`);
  }
});

test("the CSS variable names consumers rely on are all still declared", () => {
  // Renaming one of these silently unstyles a whole surface: the class is
  // still applied, the var just never resolves, so text falls back with no
  // error anywhere. Pinned deliberately.
  const src = readFileSync("src/lib/fonts.ts", "utf8");
  for (const v of [
    "--pf-sans", "--pf-mono", "--pf-serif", "--pf-hand", "--pf-cormorant", "--pf-lora",
    "--of-font-serif", "--of-font-sans", "--of-font-script", "--of-font-mono",
  ]) {
    assert.ok(src.includes(`variable: "${v}"`), `${v} is no longer declared — whatever uses it will silently fall back`);
  }
});

test("the font files are real woff2, not truncated downloads", () => {
  for (const f of readdirSync("src/fonts")) {
    const buf = readFileSync(join("src/fonts", f));
    assert.ok(buf.length > 5_000, `${f} is only ${buf.length} bytes`);
    // woff2 magic number: "wOF2"
    assert.equal(buf.subarray(0, 4).toString("latin1"), "wOF2", `${f} is not a woff2 file`);
  }
});
