/**
 * VideoPsalm importer tests (2026-09-01).
 * Run: npx tsx test/videopsalm-parser.test.ts
 *
 * VideoPsalm exports "almost JSON" — unquoted object keys + RAW newlines inside
 * string values. These tests prove we normalise + parse it into songs/slides.
 */
import assert from "node:assert";
import { videopsalmParser, normalizeVideoPsalmJson } from "../src/lib/parsers/videopsalm";

let pass = 0, fail = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n         ${(e as Error).message}`); fail++; }
}

// A realistic VideoPsalm songbook: UNQUOTED keys + RAW newlines inside "Text".
const MALFORMED = `{
  Text: "My Church Songbook",
  Songs: [
    {
      Text: "Amazing Grace",
      Author: "John Newton",
      Composer: "Traditional",
      CCLI: "22025",
      Copyright: "Public Domain",
      Verses: [
        { Text: "Amazing grace how sweet the sound
That saved a wretch like me" },
        { Text: "I once was lost but now am found
Was blind but now I see" }
      ]
    },
    {
      Text: "Great Is Thy Faithfulness",
      Author: "Thomas Chisholm",
      Verses: [ { Text: "Great is thy faithfulness
O God my Father" } ]
    }
  ]
}`;

async function main() {
  console.log("VideoPsalm importer");

  await check("raw file is NOT valid JSON (unquoted keys + raw newlines)", () => {
    let threw = false;
    try { JSON.parse(MALFORMED); } catch { threw = true; }
    assert.ok(threw, "expected the raw VideoPsalm export to be invalid JSON");
  });

  await check("normalizeVideoPsalmJson makes it parseable", () => {
    const fixed = normalizeVideoPsalmJson(MALFORMED);
    const data = JSON.parse(fixed);
    assert.strictEqual(data.Text, "My Church Songbook");
    assert.strictEqual(data.Songs.length, 2);
  });

  await check("parse() extracts songs, titles, artists, and per-verse slides", async () => {
    const res = await videopsalmParser.parse([{ name: "songbook.json", buffer: Buffer.from(MALFORMED) }]);
    assert.strictEqual(res.songs.length, 2, `got ${res.songs.length} songs`);
    const ag = res.songs[0];
    assert.strictEqual(ag.title, "Amazing Grace");
    assert.strictEqual(ag.artist, "John Newton");
    assert.strictEqual(ag.slides.length, 2, "Amazing Grace should have 2 verse slides");
    assert.ok(ag.slides[0].includes("Amazing grace how sweet"));
    assert.ok(ag.slides[0].includes("wretch like me"), "raw newline inside a verse is preserved");
    assert.strictEqual(res.songs[1].title, "Great Is Thy Faithfulness");
    assert.strictEqual(res.skipped.length, 0);
  });

  await check("well-formed (already-valid) VideoPsalm JSON also parses", async () => {
    const valid = JSON.stringify({ Text: "SB", Songs: [{ Text: "Test Song", Author: "A", Verses: [{ Text: "line one\nline two" }] }] });
    const res = await videopsalmParser.parse([{ name: "sb.json", buffer: Buffer.from(valid) }]);
    assert.strictEqual(res.songs.length, 1);
    assert.strictEqual(res.songs[0].slides.length, 1);
  });

  await check("inline chords are stripped from lyrics", async () => {
    const valid = JSON.stringify({ Songs: [{ Text: "Chorded", Verses: [{ Text: "[G]Amazing [C]grace" }] }] });
    const res = await videopsalmParser.parse([{ name: "c.json", buffer: Buffer.from(valid) }]);
    assert.strictEqual(res.songs[0].slides[0], "Amazing grace");
  });

  await check(".vpc gives a clear export-to-JSON message, doesn't crash", async () => {
    const res = await videopsalmParser.parse([{ name: "book.vpc", buffer: Buffer.from([1, 2, 3]) }]);
    assert.strictEqual(res.songs.length, 0);
    assert.strictEqual(res.skipped.length, 1);
    assert.ok(/export.*json/i.test(res.skipped[0].reason), "should guide to JSON export");
  });

  await check("non-VideoPsalm JSON (no Songs array) is skipped, not crashed", async () => {
    const res = await videopsalmParser.parse([{ name: "other.json", buffer: Buffer.from('{"foo":1}') }]);
    assert.strictEqual(res.songs.length, 0);
    assert.strictEqual(res.skipped.length, 1);
  });

  await check("detect scores .json / .vpc, ignores unrelated files", () => {
    assert.ok(videopsalmParser.detect([{ name: "a.json", size: 10 }]) > 0);
    assert.ok(videopsalmParser.detect([{ name: "a.vpc", size: 10 }]) > 0);
    assert.strictEqual(videopsalmParser.detect([{ name: "a.pro6", size: 10 }]), 0);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
