/**
 * Adversarial: the song chunker is SONGS ONLY and must never be wired into a
 * Bible-verse or media code path (spec §3a "behind a flag; verses/media
 * untouched" + review fold §9.5). This test walks src/ and fails if any module
 * whose path looks verse/scripture/bible/media/memory-related imports
 * `song-chunk`. Run: npx tsx --test test/adversarial/song-chunk-scope.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src");
const FORBIDDEN_PATH = /(bible|verse|scripture|media|memory)/i;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

test("no verse/media/bible module imports song-chunk", () => {
  const offenders: string[] = [];
  for (const file of walk(SRC)) {
    // Skip the chunker itself and its constants.
    if (/song-chunk(\-constants)?\.ts$/.test(file)) continue;
    const src = readFileSync(file, "utf8");
    if (!/from\s+["'][^"']*song-chunk(-constants)?["']/.test(src)) continue;
    if (FORBIDDEN_PATH.test(file)) offenders.push(file);
  }
  assert.deepEqual(
    offenders,
    [],
    `song-chunk must never be imported by verse/media/bible modules:\n${offenders.join("\n")}`,
  );
});

test("song-chunk importers are on the song import path only", () => {
  const importers: string[] = [];
  for (const file of walk(SRC)) {
    if (/song-chunk(\-constants)?\.ts$/.test(file)) continue;
    const src = readFileSync(file, "utf8");
    if (/from\s+["'][^"']*song-chunk(-constants)?["']/.test(src)) importers.push(file);
  }
  // Every importer must live under a song/import-related path. If this trips,
  // a new call site was added — confirm it's genuinely a song path and extend
  // the allow-list, don't just silence it. `actions` = the server-action home of
  // reChunkSong/reChunkAllSongs (A2 re-chunk of existing songs).
  const ALLOW = /(song|import|parsers|actions)/i;
  const rogue = importers.filter((f) => !ALLOW.test(f));
  assert.deepEqual(rogue, [], `unexpected song-chunk importer(s):\n${rogue.join("\n")}`);
});
