/**
 * Composable round 5 fix-up: quick-edit runs remap, song→slides lock order on
 * theme bake/revert/re-apply, quick-edit refresh keeps words + stanza breaks,
 * and quickEditInPlace routing per slide shape.
 *
 * Run: npx tsx test/composable-round5b.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { remapRunsForTextEdit, splitIntoSegments } from "../src/lib/text-runs";
import { sanitizeLyrics } from "../src/lib/pro6-parser";
import { quickEditInPlace } from "../src/lib/slide-inherit";

let passed = 0, failed = 0;
function check(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : e}`); }
}
const boldWords = (text: string, runs: ReturnType<typeof remapRunsForTextEdit>) =>
  (runs ?? []).filter((r) => r.bold).map((r) => text.slice(r.start, r.end));

console.log("1. quick edit re-maps PP7 runs (bold on word 2)");
// PP7-style single box: "Amazing grace how sweet" with "grace" bold.
const OLD = "Amazing grace how sweet";
const RUNS = [{ start: 8, end: 13, bold: true }];
check("word 1 length edited by replacement → dropped or still on 'grace', never misplaced", () => {
  const next = "Amaze grace how sweet"; // "ing" → "e" is a replacement…
  const r = remapRunsForTextEdit(RUNS, OLD, next);
  // …so conservatively either dropped or still exactly on "grace" — never misplaced.
  const b = boldWords(next, r);
  assert.ok(b.length === 0 || (b.length === 1 && b[0] === "grace"), JSON.stringify(b));
});
check("word 1 pure deletion → bold still exactly 'grace'", () => {
  const next = "Amaz grace how sweet";
  assert.deepEqual(boldWords(next, remapRunsForTextEdit(RUNS, OLD, next)), ["grace"]);
});
check("word 1 pure insertion → bold still exactly 'grace'", () => {
  const next = "Amazingly grace how sweet";
  assert.deepEqual(boldWords(next, remapRunsForTextEdit(RUNS, OLD, next)), ["grace"]);
});
check("ambiguous replacement → runs dropped (never on the wrong word)", () => {
  assert.equal(remapRunsForTextEdit(RUNS, OLD, "Wonderful grace how sweet"), undefined);
});
check("unchanged text keeps runs; no runs stays undefined", () => {
  assert.deepEqual(boldWords(OLD, remapRunsForTextEdit(RUNS, OLD, OLD)), ["grace"]);
  assert.equal(remapRunsForTextEdit(undefined, OLD, "x"), undefined);
});
check("renders with segments aligned to the new text", () => {
  const next = "Amazingly grace how sweet";
  const seg = splitIntoSegments(next, remapRunsForTextEdit(RUNS, OLD, next));
  assert.equal(seg.map((s) => s.text).join(""), next);
});
check("updateSongSlideText uses remapRunsForTextEdit", () => {
  const src = readFileSync("src/lib/actions.ts", "utf8");
  const fn = src.slice(src.indexOf("export async function updateSongSlideText"), src.indexOf("export async function createSongSlide"));
  assert.ok(fn.includes("remapRunsForTextEdit("));
});

console.log("2. song → slides lock order");
check("bake / revert / re-apply lock slides FOR UPDATE after the song", () => {
  const src = readFileSync("src/lib/actions.ts", "utf8");
  for (const [start, end] of [
    ["async function bakeThemeIntoSongTx", "export async function applyThemeToSong("],
    ["export async function revertSongTheme", "export async function reapplyThemeToSongs"],
    ["export async function reapplyThemeToSongs", null],
  ] as const) {
    const a = src.indexOf(start);
    assert.ok(a > 0, start);
    const body = src.slice(a, end ? src.indexOf(end, a) : a + 6000);
    const songLock = body.indexOf('.for("update")');
    const slideLock = body.indexOf('.from(songSlides).where(eq(songSlides.songId, songId)).for("update")');
    assert.ok(songLock > 0 && slideLock > songLock, `${start}: song lock then slides lock`);
  }
});

console.log("3. quick-edit refresh keeps words + stanza breaks");
check("sanitizeLyrics collapses \\n\\n\\n to \\n\\n but keeps every word + the break", () => {
  const out = sanitizeLyrics("Amazing grace\n\n\nHow sweet the sound");
  assert.ok(out.includes("\n\n"), JSON.stringify(out));
  assert.ok(!out.includes("\n\n\n"));
  assert.deepEqual(out.split(/\s+/).filter(Boolean), ["Amazing", "grace", "How", "sweet", "the", "sound"]);
});

console.log("5. quickEditInPlace routing (unthemed)");
const T = (id: string) => ({ id, kind: "text", text: id });
check("plain → in place", () => assert.equal(quickEditInPlace(false, null), true));
check("single-box → in place", () => assert.equal(quickEditInPlace(false, { objects: [T("a")] }), true));
check("multi-box → rewrite-all", () => assert.equal(quickEditInPlace(false, { objects: [T("a"), T("b")] }), false));
check("media-only → rewrite-all", () => assert.equal(quickEditInPlace(false, { objects: [{ id: "v", kind: "video" }] }), false));
check("SongsBrowser: in-place branch calls updateSongSlideText, else updateSongSlides", () => {
  const src = readFileSync("src/components/operator/pro/center/SongsBrowser.tsx", "utf8");
  const gate = src.indexOf("quickEditInPlace(songThemed, target.objectsJson)");
  const inPlace = src.indexOf("updateSongSlideText(target.id, editDraft)", gate);
  const rewrite = src.indexOf("updateSongSlides(selected.id, next)", gate);
  assert.ok(gate > 0 && inPlace > gate && rewrite > inPlace);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
