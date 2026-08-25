/**
 * A1 wiring integration — the CSV/plain-text import path with the chunking flag
 * ON vs OFF. Proves: (a) flag OFF is the legacy blank-line split (byte-identical),
 * (b) flag ON produces clean ≤2-line chunked slides, (c) the structured CSV-cell
 * shape is never chunked regardless of the flag.
 * Run: npx tsx --test test/song-chunk-import.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOne } from "../src/lib/parsers/csv";

const PLAINTEXT = [
  "Amazing Grace",
  "by John Newton",
  "Amazing grace how sweet the sound",
  "That saved a wretch like me",
  "I once was lost but now am found",
  "Was blind but now I see",
].join("\n");

function withFlag<T>(value: string | undefined, fn: () => T): T {
  const prev = process.env.SONG_CHUNK_ENABLED;
  if (value === undefined) delete process.env.SONG_CHUNK_ENABLED;
  else process.env.SONG_CHUNK_ENABLED = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.SONG_CHUNK_ENABLED;
    else process.env.SONG_CHUNK_ENABLED = prev;
  }
}

test("flag OFF → legacy blank-line split (one stanza = one slide)", () => {
  const songs = withFlag("0", () => parseOne(PLAINTEXT, "x.txt"));
  assert.equal(songs.length, 1);
  assert.equal(songs[0].title, "Amazing Grace");
  assert.equal(songs[0].artist, "John Newton");
  // No blank line in the body → legacy split yields ONE clunky 4-line slide.
  assert.deepEqual(songs[0].slides, [
    "Amazing grace how sweet the sound\nThat saved a wretch like me\nI once was lost but now am found\nWas blind but now I see",
  ]);
});

test("flag ON → clean ≤2-line chunked slides", () => {
  const songs = withFlag("1", () => parseOne(PLAINTEXT, "x.txt"));
  assert.equal(songs.length, 1);
  assert.deepEqual(songs[0].slides, [
    "Amazing grace how sweet the sound\nThat saved a wretch like me",
    "I once was lost but now am found\nWas blind but now I see",
  ]);
  for (const s of songs[0].slides) assert.ok(s.split("\n").length <= 2);
});

test("structured CSV-cell shape is never chunked (author's slides preserved)", () => {
  const csv = "Amazing Grace,John Newton,Amazing grace how sweet the sound that saved a wretch like me,I once was lost but now am found was blind but now I see";
  for (const flag of ["0", "1"]) {
    const songs = withFlag(flag, () => parseOne(csv, "x.csv"));
    assert.equal(songs.length, 1, `flag ${flag}`);
    // Each comma cell stays exactly one slide — the flag must not touch this path.
    assert.deepEqual(songs[0].slides, [
      "Amazing grace how sweet the sound that saved a wretch like me",
      "I once was lost but now am found was blind but now I see",
    ], `flag ${flag} altered CSV-cell slides`);
  }
});
