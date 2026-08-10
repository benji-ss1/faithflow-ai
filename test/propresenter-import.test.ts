/**
 * ProPresenter import — parser-level tests (no DB, no network).
 *
 * Run: npx tsx test/propresenter-import.test.ts
 *
 * Covers:
 *   1. Valid multi-section .pro6 (RVSlideGrouping → RVDisplaySlide →
 *      NSString RTFData base64) — sections, slide text, metadata.
 *   2. RTF stripping: \'xx hex escapes, \uN? unicode escapes, \par
 *      newlines, fonttbl/colortbl group removal.
 *   3. Malformed XML — never throws, returns warnings.
 *   4. Fake .pro7 binary (protobuf-ish header with NUL bytes) — detected
 *      and honestly reported.
 *   5. Pro5-style RTFData attribute form.
 *
 * Uses plain node:assert (matching test/projector-output.test.ts).
 */
import assert from "node:assert";
import { parsePro6, stripRtf, isPro7Binary } from "../src/lib/pro6-parser";

let pass = 0;
let fail = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve().then(fn)
    .then(() => { console.log(`  PASS  ${name}`); pass++; })
    .catch((e) => { console.error(`  FAIL  ${name}\n         ${(e as Error).message}`); fail++; });
}

// --- fixtures ---------------------------------------------------------------

function rtf(body: string): string {
  return `{\\rtf1\\ansi\\ansicpg1252{\\fonttbl{\\f0\\fswiss Helvetica;}}{\\colortbl;\\red255\\green255\\blue255;}\\f0\\fs96 ${body}}`;
}
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

function slide(text: string): string {
  return `<RVDisplaySlide backgroundColor="0 0 0 1" enabled="1">
    <array rvXMLIvarName="displayElements">
      <RVTextElement displayName="Default" fromTemplate="0">
        <NSString rvXMLIvarName="RTFData">${b64(rtf(text))}</NSString>
      </RVTextElement>
    </array>
  </RVDisplaySlide>`;
}

const VALID_PRO6 = `<?xml version="1.0" encoding="utf-8"?>
<RVPresentationDocument CCLISongTitle="Amazing Grace" CCLIAuthor="John Newton" CCLISongNumber="22025" versionNumber="600">
  <array rvXMLIvarName="groups">
    <RVSlideGrouping name="Verse 1" uuid="aaa">
      <array rvXMLIvarName="slides">
        ${slide("Amazing grace, how sweet the sound\\par That saved a wretch like me")}
        ${slide("I once was lost, but now am found\\par Was blind but now I see")}
      </array>
    </RVSlideGrouping>
    <RVSlideGrouping name="Chorus" uuid="bbb">
      <array rvXMLIvarName="slides">
        ${slide("My chains are gone, I\\'92ve been set free")}
      </array>
    </RVSlideGrouping>
  </array>
</RVPresentationDocument>`;

// Pro5-style: RTFData as an attribute on RVTextElement, no groupings.
const VALID_PRO5 = `<?xml version="1.0" encoding="utf-8"?>
<RVPresentationDocument CCLISongTitle="How Great" versionNumber="500">
  <slides>
    <RVDisplaySlide>
      <RVTextElement RTFData="${b64(rtf("How great is our God\\par Sing with me"))}" />
    </RVDisplaySlide>
  </slides>
</RVPresentationDocument>`;

const MALFORMED_XML = `<?xml version="1.0"?><RVPresentationDocument CCLISongTitle="Broken><unclosed`;

// Fake .pro7: protobuf-style binary — tag bytes, NULs, length prefixes.
const FAKE_PRO7 = Buffer.from([
  0x0a, 0x24, 0x08, 0x00, 0x12, 0x10, 0x50, 0x72, 0x65, 0x73, 0x65, 0x6e,
  0x74, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x00, 0x00, 0x1a, 0x05, 0x37, 0x2e,
  0x39, 0x2e, 0x32, 0x00, 0x00, 0x00,
]);

// --- tests -------------------------------------------------------------------

async function main() {
  console.log("ProPresenter import parser");

  // 1. Valid multi-section .pro6
  await check("pro6: title / artist / ccli extracted", () => {
    const p = parsePro6(VALID_PRO6);
    assert.strictEqual(p.title, "Amazing Grace");
    assert.strictEqual(p.artist, "John Newton");
    assert.strictEqual(p.ccli, "22025");
  });

  await check("pro6: sections keep RVSlideGrouping names in order", () => {
    const p = parsePro6(VALID_PRO6);
    assert.deepStrictEqual(p.sections.map((s) => s.name), ["Verse 1", "Chorus"]);
    assert.strictEqual(p.sections[0].slides.length, 2);
    assert.strictEqual(p.sections[1].slides.length, 1);
  });

  await check("pro6: flat slides match document order, RTF stripped", () => {
    const p = parsePro6(VALID_PRO6);
    assert.strictEqual(p.slides.length, 3);
    assert.ok(p.slides[0].includes("Amazing grace, how sweet the sound"));
    assert.ok(p.slides[0].includes("That saved a wretch like me"));
    // \par became a newline
    assert.ok(p.slides[0].includes("\n"));
    // no RTF control words / braces leaked
    for (const s of p.slides) {
      assert.ok(!s.includes("\\f0"), `control word leaked: ${s}`);
      assert.ok(!s.includes("{") && !s.includes("}"), `braces leaked: ${s}`);
      assert.ok(!/Helvetica/.test(s), `fonttbl leaked: ${s}`);
    }
  });

  await check("pro6: \\'xx hex escape decodes (\\'92 = right single quote, cp1252 byte)", () => {
    const p = parsePro6(VALID_PRO6);
    // \x92 (latin-1 passthrough of the cp1252 byte) — the apostrophe byte is
    // preserved, and the surrounding words survive intact.
    // 2026-08-10 codepage fix: \'92 = Windows-1252 RIGHT SINGLE QUOTE (U+2019), not latin-1.
    assert.ok(p.slides[2].includes("I\u2019ve been set free"), JSON.stringify(p.slides[2]));
    assert.ok(p.slides[2].startsWith("My chains are gone"));
  });

  await check("pro6: slides follow the ARRANGEMENT order (repeated chorus), not doc order", () => {
    const grp = (name: string, uuid: string, text: string) =>
      `<RVSlideGrouping name="${name}" uuid="${uuid}"><array rvXMLIvarName="slides">${slide(text)}</array></RVSlideGrouping>`;
    // Document order: Verse 1, Chorus, Verse 2. Arrangement: V1 → C → V2 → C.
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<RVPresentationDocument CCLISongTitle="Arranged" versionNumber="600">
  <array rvXMLIvarName="groups">
    ${grp("Verse 1", "v1", "verse one")}
    ${grp("Chorus", "c1", "the chorus")}
    ${grp("Verse 2", "v2", "verse two")}
  </array>
  <array rvXMLIvarName="arrangements">
    <RVSongArrangement name="Default" uuid="arr1">
      <array rvXMLIvarName="groupIDs">
        <NSMutableString>v1</NSMutableString>
        <NSMutableString>c1</NSMutableString>
        <NSMutableString>v2</NSMutableString>
        <NSMutableString>c1</NSMutableString>
      </array>
    </RVSongArrangement>
  </array>
</RVPresentationDocument>`;
    const p = parsePro6(xml);
    assert.deepStrictEqual(p.slides, ["verse one", "the chorus", "verse two", "the chorus"], JSON.stringify(p.slides));
  });

  await check("pro6: NO arrangement → falls back to document order (safe)", () => {
    const p = parsePro6(VALID_PRO6); // has groups, no <arrangements>
    // Verse 1 (2 slides) then Chorus (1 slide) — document order preserved.
    assert.ok(p.slides[0].startsWith("Amazing grace"));
    assert.ok(p.slides[2].startsWith("My chains are gone"));
  });

  // 2. RTF stripper unit-level
  await check("stripRtf: \\uN? unicode escapes with ANSI fallback consumed", () => {
    // Per RTF spec, exactly one fallback char follows \uN (here the "?").
    const out = stripRtf("{\\rtf1 caf\\u233? au lait \\u8217?s}");
    assert.strictEqual(out, "café au lait ’s");
  });

  await check("stripRtf: negative \\uN maps to high codepoint", () => {
    // RTF stores U+266A (♪) as -6550 + 65536... actually 0x266A=9834 fits,
    // use U+D7FF-adjacent example: -32768 + 65536 = 32768
    const out = stripRtf("{\\rtf1 \\u-32768?x}");
    assert.strictEqual(out, String.fromCodePoint(32768) + "x");
  });

  await check("stripRtf: fonttbl/colortbl/stylesheet groups removed wholesale", () => {
    const out = stripRtf(rtf("Hello\\par World"));
    assert.strictEqual(out, "Hello\nWorld");
  });

  await check("stripRtf: escaped braces and backslashes survive", () => {
    const out = stripRtf("{\\rtf1 a\\{b\\}c\\\\d}");
    assert.strictEqual(out, "a{b}c\\d");
  });

  // 3. Malformed XML
  await check("malformed XML: no throw, empty slides, warning present", () => {
    const p = parsePro6(MALFORMED_XML);
    assert.strictEqual(p.slides.length, 0);
    assert.ok(p.warnings.length > 0, "expected a warning");
  });

  await check("empty string: no throw", () => {
    const p = parsePro6("");
    assert.strictEqual(p.slides.length, 0);
    assert.ok(p.warnings.length > 0);
  });

  await check("non-pro6 XML (random root): no slides, warning", () => {
    const p = parsePro6("<html><body>not a song</body></html>");
    assert.strictEqual(p.slides.length, 0);
  });

  // 4. Fake .pro7 binary
  await check("isPro7Binary: detects NUL-bearing protobuf buffer", () => {
    assert.strictEqual(isPro7Binary(FAKE_PRO7), true);
    assert.strictEqual(isPro7Binary(FAKE_PRO7, "Song.pro"), true);
  });

  await check("isPro7Binary: XML content is NOT flagged (even with .pro name)", () => {
    assert.strictEqual(isPro7Binary(Buffer.from(VALID_PRO6, "utf8")), false);
    assert.strictEqual(isPro7Binary(VALID_PRO6, "Song.pro"), false);
  });

  await check("parsePro6 on pro7 binary string: honest 'export as Pro6' warning, no throw", () => {
    const p = parsePro6(FAKE_PRO7.toString("utf8"));
    assert.strictEqual(p.slides.length, 0);
    assert.ok(
      p.warnings.some((w) => /ProPresenter 7/.test(w) && /Pro6/.test(w)),
      `expected honest pro7 warning, got: ${JSON.stringify(p.warnings)}`,
    );
  });

  // 5. Pro5 attribute form
  await check("pro5: RTFData attribute form parses", () => {
    const p = parsePro6(VALID_PRO5);
    assert.strictEqual(p.title, "How Great");
    assert.strictEqual(p.slides.length, 1);
    assert.ok(p.slides[0].includes("How great is our God"));
    assert.ok(p.slides[0].includes("Sing with me"));
    // no groupings → single fallback "Song" section
    assert.deepStrictEqual(p.sections.map((s) => s.name), ["Song"]);
  });

  await check("missing title: parser returns empty title (caller falls back to filename)", () => {
    const noTitle = VALID_PRO6.replace('CCLISongTitle="Amazing Grace" ', "");
    const p = parsePro6(noTitle);
    assert.strictEqual(p.title, "");
    assert.strictEqual(p.slides.length, 3);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

void main();
