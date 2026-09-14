/**
 * VideoPsalm relaxed-JSON parser tests.
 *
 * Run: npx tsx test/videopsalm.test.ts
 *
 * The .vpagd `Song_N.json` format is NOT strict JSON: bare identifier keys,
 * RAW newlines inside string values, smart quotes. These fixtures mirror the
 * exact shape of real Loveworld/VideoPsalm exports (verified against sample
 * files) so a regression in the tolerant reader is caught here.
 *
 * Uses plain node:assert (matching test/bible-antireplay.test.ts).
 */
import assert from "node:assert";
import { parseRelaxedJson, extractSong } from "../src/lib/import/videopsalm";

let pass = 0;
let fail = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn())
    .then(() => { console.log(`  PASS  ${name}`); pass++; })
    .catch((e) => { console.error(`  FAIL  ${name}\n         ${(e as Error).message}`); fail++; });
}

// A real-shaped song: bare keys, first verse has no ID, multi-line raw-newline
// text, smart apostrophes, a trailing top-level Text (the TITLE), nested Style.
const SONG = `{Author:"Loveworld singers ",Guid:"gjMYyr3hIkys0BgcIAnp6Q",Verses:[{
Text:"You’re the King of glory
You are great and mighty
Heaven and earth belong to You"},{ID:2,
Text:"You’re exalted, oh Lord
Far above all powers"}],Style:{Background:{Brush:{Color:"00000000"}}},
Text:"You're the king of glory "}`;

async function main() {
  console.log("VideoPsalm parser\n");

  await check("parses bare keys + nested objects without throwing", () => {
    const o = parseRelaxedJson(SONG) as Record<string, unknown>;
    assert.strictEqual(typeof o, "object");
    assert.strictEqual(o.Author, "Loveworld singers ");
    assert.strictEqual(o.Guid, "gjMYyr3hIkys0BgcIAnp6Q");
    assert.ok(Array.isArray(o.Verses));
  });

  await check("title = top-level Text, artist = Author (trimmed)", () => {
    const s = extractSong(parseRelaxedJson(SONG))!;
    assert.strictEqual(s.title, "You're the king of glory");
    assert.strictEqual(s.artist, "Loveworld singers");
  });

  await check("one slide per verse, raw newlines preserved inside a slide", () => {
    const s = extractSong(parseRelaxedJson(SONG))!;
    assert.strictEqual(s.slides.length, 2);
    assert.ok(s.slides[0]!.includes("\n"), "multi-line verse keeps its line breaks");
    assert.ok(s.slides[0]!.startsWith("You’re the King of glory"), "smart quote preserved");
    assert.ok(s.slides[1]!.startsWith("You’re exalted"));
  });

  await check("string escapes (\\n \\\" \\\\) decode correctly", () => {
    const o = parseRelaxedJson(`{Text:"line1\\nline2 \\"q\\" end\\\\"}`) as Record<string, unknown>;
    assert.strictEqual(o.Text, 'line1\nline2 "q" end\\');
  });

  await check("empty / no-verse song → null (skipped, not a blank song)", () => {
    assert.strictEqual(extractSong(parseRelaxedJson(`{Author:"x",Verses:[]}`)), null);
  });

  await check("verse with no Text is dropped, not turned into an empty slide", () => {
    const s = extractSong(parseRelaxedJson(`{Verses:[{ID:1,Text:"a"},{ID:2}],Text:"T"}`))!;
    assert.strictEqual(s.slides.length, 1);
    assert.strictEqual(s.slides[0], "a");
  });

  await check("BOM is stripped", () => {
    const o = parseRelaxedJson("﻿{Text:\"T\",Verses:[{Text:\"a\"}]}") as Record<string, unknown>;
    assert.strictEqual(o.Text, "T");
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
