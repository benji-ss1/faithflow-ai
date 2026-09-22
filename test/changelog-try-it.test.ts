/**
 * What's New "Try it" markers — parser tests.
 *
 * Run: npx tsx test/changelog-try-it.test.ts
 *
 * A change note can end a bullet with `{try: /path | spotlight | Label}`,
 * which becomes a button in the What's New modal that navigates to the screen
 * AND rings the real control (data-vic="<spotlight>").
 *
 * These pin the parsing, because a malformed marker would otherwise ship as
 * literal "{try: ...}" text in front of every operator.
 */
import assert from "node:assert";
import { parseChangeFile } from "../scripts/changelog-lib.mjs";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n         ${(e as Error).message}`); fail++; }
}

const note = (highlights: string[]) =>
  ["---", "headline: H", "version: 0.1.999", "date: 2026-09-22", "highlights:",
    ...highlights.map((h) => `  - ${h}`), "---", ""].join("\n");

const parse = (highlights: string[]) => parseChangeFile(note(highlights), "t").highlights;

console.log("\nWhat's New — try-it markers\n");

check("a plain bullet stays a plain string", () => {
  assert.deepStrictEqual(parse(["Just words."]), ["Just words."]);
});

check("href + spotlight + label all parse", () => {
  assert.deepStrictEqual(parse(['"Text here. {try: /operator | smart-folder | Show me where}"']), [
    { text: "Text here.", tryItHref: "/operator", highlightParam: "smart-folder", tryItLabel: "Show me where" },
  ]);
});

check("href alone parses (navigate, no ring)", () => {
  assert.deepStrictEqual(parse(["Text. {try: /services}"]), [{ text: "Text.", tryItHref: "/services" }]);
});

check("an empty spotlight slot is skipped, label still applies", () => {
  assert.deepStrictEqual(parse(['"Text. {try: /library/songs | | Open Songs}"']), [
    { text: "Text.", tryItHref: "/library/songs", tryItLabel: "Open Songs" },
  ]);
});

check("the marker is stripped from the visible text", () => {
  const [h] = parse(["Visible words only. {try: /operator | smart-folder}"]) as { text: string }[];
  assert.ok(!h.text.includes("{try"), `marker leaked into copy: ${h.text}`);
  assert.strictEqual(h.text, "Visible words only.");
});

check("a link that is not a path is REJECTED, not shipped as text", () => {
  // An external or malformed link would navigate nowhere useful.
  assert.throws(() => parse(["Text. {try: https://example.com}"]), /must start with/);
});

check("a marker with no link is REJECTED", () => {
  assert.throws(() => parse(["Text. {try: }"]), /needs a link/);
});

check("a marker with no text before it is REJECTED", () => {
  assert.throws(() => parse(["{try: /operator}"]), /needs text before it/);
});

check("braces that are not a try-marker are left alone", () => {
  assert.deepStrictEqual(parse(["Use the {rules} builder."]), ["Use the {rules} builder."]);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
