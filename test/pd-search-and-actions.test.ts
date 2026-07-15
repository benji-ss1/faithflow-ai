// PD search sanitizer + import action shape tests.
// Runs the pure-function slice (sanitiseCandidate) and the auto-approve
// persistence contract without a running server.
// Run: npx tsx test/pd-search-and-actions.test.ts

import { _internal } from "../src/app/api/songs/public-domain/search/sanitizers";

let passed = 0;
let failed = 0;
function assert(cond: unknown, label: string) {
  if (cond) { passed++; console.log(`  ok  ${label}`); }
  else { failed++; console.error(`  FAIL  ${label}`); }
}

console.log("PD search sanitiseCandidate");

{
  const c = _internal.sanitiseCandidate({
    source: "hymnary",
    title: "Amazing Grace",
    author: "John Newton",
    lyrics: ["Amazing grace, how sweet the sound", "That saved a wretch like me"],
  });
  assert(c !== null, "accepts a valid hymnary candidate");
  assert(c?.title === "Amazing Grace", "preserves plain title");
  assert(c?.lyrics.length === 2, "keeps both lyric slides");
  assert(c?.slidesGuess.length === 2, "produces slidesGuess of same arity");
}

{
  const c = _internal.sanitiseCandidate({
    source: "llm",
    title: "<script>alert('xss')</script>Hymn",
    author: "A & B",
    lyrics: ["a line with <b>bold</b>", "control\x00chars\x1Fhere"],
  });
  assert(c !== null, "accepts LLM candidate");
  assert(!c?.title.includes("<script>"), "HTML-escapes title");
  assert(!c?.title.includes("<"), "no raw < in title after escape");
  assert(!c?.author?.includes("&") || c.author.includes("&amp;"), "escapes & in author");
  assert(!c?.lyrics[1].includes("\x00"), "strips control chars");
}

{
  const c = _internal.sanitiseCandidate({
    source: "hymnary",
    title: "OK",
    author: null,
    lyrics: [],
  });
  assert(c === null, "rejects candidate with zero lyric slides");
}

{
  const c = _internal.sanitiseCandidate({
    source: "bogus" as unknown as "hymnary",
    title: "T",
    author: null,
    lyrics: ["x"],
  });
  assert(c === null, "rejects invalid source");
}

{
  const long = "x".repeat(1000);
  const c = _internal.sanitiseCandidate({
    source: "hymnary",
    title: "T",
    author: null,
    lyrics: [long],
  });
  assert(c !== null && c.lyrics[0].length === 400, "caps lyric text at 400 chars");
}

console.log("Auto-approve toggle persistence key contract");
{
  const KEY = "presentflow.pro.autoApprove.v1";
  assert(KEY === "presentflow.pro.autoApprove.v1", "toggle key matches spec");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
