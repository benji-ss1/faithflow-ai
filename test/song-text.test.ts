// Tests the plain-text song importer (EasyWorship/ProPresenter text export path).
// Run: npx tsx test/song-text.test.ts
import assert from "node:assert";
import { parseSongText } from "../src/lib/import/song-text";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log("  PASS " + name); pass++; }
  catch (e) { console.error("  FAIL " + name + "\n    " + (e as Error).message); fail++; }
}

check("real sample: Title header (.pro stripped) + blank-line slide split", () => {
  const raw = "Title: let praises rise .pro\n\nLet praises rise from the inside\nFrom the inside of me\nCome fill my life from the inside\n\n\n\nFrom the inside of me\nSet me on fire from the inside\n";
  const s = parseSongText(raw, "let praises rise .txt");
  assert.equal(s.title, "let praises rise");
  assert.equal(s.slides.length, 2);
  assert.ok(s.slides[0]!.startsWith("Let praises rise"));
  assert.ok(s.slides[1]!.startsWith("From the inside"));
});

check("Author/Artist/By header → artist", () => {
  assert.equal(parseSongText("Title: T\nAuthor: Jane Doe\n\nline").artist, "Jane Doe");
  assert.equal(parseSongText("Title: T\nArtist: X\n\nline").artist, "X");
  assert.equal(parseSongText("Title: T\nBy: Y\n\nline").artist, "Y");
});

check("no Title header → filename is the title, whole file is lyrics", () => {
  const s = parseSongText("Verse one\nline two\n\nVerse two", "How Great.txt");
  assert.equal(s.title, "How Great");
  assert.equal(s.slides.length, 2);
});

check("CRLF + BOM handled", () => {
  const s = parseSongText("﻿Title: T\r\n\r\na\r\nb\r\n\r\nc", "x.txt");
  assert.equal(s.title, "T");
  assert.equal(s.slides.length, 2);
  assert.equal(s.slides[0], "a\nb");
});

check("empty / whitespace-only file → no slides, safe", () => {
  const s = parseSongText("   \n\n  \n", "x.txt");
  assert.equal(s.slides.length, 0);
  assert.equal(s.title, "x");
});

check("multiple blank lines collapse to one slide break", () => {
  const s = parseSongText("Title: T\n\nA\n\n\n\n\nB");
  assert.equal(s.slides.length, 2);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
