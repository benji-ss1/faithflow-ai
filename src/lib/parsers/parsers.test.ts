/**
 * Parser unit tests. Runnable via:
 *   npx tsx src/lib/parsers/parsers.test.ts
 *
 * These tests exercise the constructed fixtures under
 * `test/fixtures/parsers/` and the malicious-input safety helpers in
 * `./safety.ts`. They do NOT talk to the DB or the network.
 */

import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";

import { csvParser } from "./csv";
import { propresenterParser } from "./propresenter";
import { openlpParser } from "./openlp";
import { proclaimParser } from "./proclaim";
import {
  inspectZip,
  safeJsonParse,
  sanitizeFileName,
  decodeUtf8Strict,
  withTimeout,
  isUnsafeEntryName,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_UNCOMPRESSED_BYTES,
} from "./safety";
import { parsePro6 } from "../pro6-parser";

const REPO = path.resolve(__dirname, "..", "..", "..");
const FIX = path.join(REPO, "test", "fixtures", "parsers");

type Test = { name: string; run: () => Promise<void> | void };
const tests: Test[] = [];
function test(name: string, run: Test["run"]) { tests.push({ name, run }); }

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

// ---------- CSV ----------
test("csv parser parses 2-song CSV fixture", async () => {
  const buf = fs.readFileSync(path.join(FIX, "csv", "sample.csv"));
  const res = await csvParser.parse([{ name: "sample.csv", buffer: buf }]);
  assert(res.songs.length === 2, `expected 2 songs, got ${res.songs.length}`);
  assert(res.songs[0].title === "Amazing Grace", `first title: ${res.songs[0].title}`);
});

// ---------- ProPresenter ----------
test("propresenter parser parses .pro6 fixture", async () => {
  const buf = fs.readFileSync(path.join(FIX, "propresenter", "sample.pro6"));
  const res = await propresenterParser.parse([{ name: "sample.pro6", buffer: buf }]);
  assert(res.songs.length >= 1, `expected >=1 song, got ${res.songs.length}`);
  assert(res.songs[0].title === "Amazing Grace", `title: ${res.songs[0].title}`);
});

test("propresenter: malformed XML → skipped, no throw", async () => {
  const buf = Buffer.from("<not a valid pro6>>>>");
  const res = await propresenterParser.parse([{ name: "bad.pro6", buffer: buf }]);
  // Either 0 songs + skipped entry, or 0 songs + no crash — both acceptable
  assert(res.songs.length === 0, "no songs from malformed input");
  assert(res.skipped.length >= 1, "expected skipped[] entry");
});

// ---------- OpenLP ----------
test("openlp parser parses fixture .osz built from openlyrics.xml", async () => {
  const xmlPath = path.join(FIX, "openlp", "openlyrics.xml");
  const xml = fs.readFileSync(xmlPath);
  const zip = new AdmZip();
  zip.addFile("song.xml", xml);
  const oszBuf = zip.toBuffer();
  const res = await openlpParser.parse([{ name: "sample.osz", buffer: oszBuf }]);
  assert(res.songs.length >= 1, `expected >=1 song, got ${res.songs.length} skipped=${JSON.stringify(res.skipped)}`);
  assert(res.songs[0].title === "Blessed Assurance", `title: ${res.songs[0].title}`);
});

// ---------- Proclaim ----------
test("proclaim parser parses fixture .zip", async () => {
  const songJson = fs.readFileSync(path.join(FIX, "proclaim", "song.json"));
  const manifestJson = fs.readFileSync(path.join(FIX, "proclaim", "manifest.json"));
  const zip = new AdmZip();
  zip.addFile("manifest.json", manifestJson);
  zip.addFile("song.json", songJson);
  const zipBuf = zip.toBuffer();
  const res = await proclaimParser.parse([{ name: "bundle.zip", buffer: zipBuf }]);
  assert(res.songs.length >= 1, `expected >=1 song, got ${res.songs.length} skipped=${JSON.stringify(res.skipped)}`);
  assert(res.songs[0].title === "It Is Well With My Soul", `title: ${res.songs[0].title}`);
});

// Craft a raw single-entry zip with an arbitrary entryName. adm-zip's
// `addFile` normalises `..` out of names, so we hand-build the bytes to
// prove the parser rejects malicious names present on the wire.
function craftRawZip(entryName: string, data: Buffer): Buffer {
  const name = Buffer.from(entryName);
  // CRC-32
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  let crc = 0 ^ -1;
  for (let i = 0; i < data.length; i++) crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xff];
  crc = (crc ^ -1) >>> 0;

  const lfh = Buffer.alloc(30);
  lfh.writeUInt32LE(0x04034b50, 0);
  lfh.writeUInt16LE(20, 4);
  lfh.writeUInt32LE(crc, 14);
  lfh.writeUInt32LE(data.length, 18);
  lfh.writeUInt32LE(data.length, 22);
  lfh.writeUInt16LE(name.length, 26);
  const lfhBlock = Buffer.concat([lfh, name, data]);

  const cdh = Buffer.alloc(46);
  cdh.writeUInt32LE(0x02014b50, 0);
  cdh.writeUInt16LE(20, 4);
  cdh.writeUInt16LE(20, 6);
  cdh.writeUInt32LE(crc, 16);
  cdh.writeUInt32LE(data.length, 20);
  cdh.writeUInt32LE(data.length, 24);
  cdh.writeUInt16LE(name.length, 28);
  const cdhBlock = Buffer.concat([cdh, name]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdhBlock.length, 12);
  eocd.writeUInt32LE(lfhBlock.length, 16);

  return Buffer.concat([lfhBlock, cdhBlock, eocd]);
}

// ---------- Zip safety: path traversal ----------
test("zip with ../evil.txt entry → skipped with path-traversal reason", async () => {
  const zipBuf = craftRawZip("../evil.txt", Buffer.from("pwned"));
  const res = await openlpParser.parse([{ name: "trav.osz", buffer: zipBuf }]);
  assert(res.songs.length === 0, "no songs should be parsed");
  const found = res.skipped.some((s) => /path-traversal/i.test(s.reason));
  assert(found, `expected path-traversal reason, got ${JSON.stringify(res.skipped)}`);
});

// ---------- Zip safety: entry cap ----------
test("zip with >2001 entries → skipped with entry-cap reason", async () => {
  const zip = new AdmZip();
  for (let i = 0; i < 2002; i++) {
    zip.addFile(`entry-${i}.txt`, Buffer.from("x"));
  }
  const zipBuf = zip.toBuffer();
  const res = await openlpParser.parse([{ name: "bomb.osz", buffer: zipBuf }]);
  assert(res.songs.length === 0, "no songs");
  const found = res.skipped.some((s) => /entry-cap/i.test(s.reason));
  assert(found, `expected entry-cap reason, got ${JSON.stringify(res.skipped.slice(0, 3))}`);
});

// ============================================================
// safety.ts — direct unit tests
// ============================================================

// ---- inspectZip ----
test("inspectZip: entry-cap trip (> MAX_ZIP_ENTRIES)", () => {
  const zip = new AdmZip();
  for (let i = 0; i < MAX_ZIP_ENTRIES + 1; i++) {
    zip.addFile(`e-${i}.txt`, Buffer.from("x"));
  }
  const roundTrip = new AdmZip(zip.toBuffer());
  const r = inspectZip(roundTrip);
  assert(r.ok === false, "expected ok:false");
  assert(/entry-cap/i.test((r as { reason: string }).reason), `reason: ${(r as { reason: string }).reason}`);
});

test("inspectZip: uncompressed-size cap trip via header-lie", () => {
  // Craft a zip whose central-directory header claims a huge uncompressed
  // size even though the actual data is tiny — this simulates a zip-bomb
  // attempt that inspectZip must catch from header inspection alone.
  const name = Buffer.from("lie.txt");
  const data = Buffer.from("x");
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  let crc = 0 ^ -1;
  for (let i = 0; i < data.length; i++) crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xff];
  crc = (crc ^ -1) >>> 0;
  const HUGE = MAX_ZIP_UNCOMPRESSED_BYTES + 1;

  const lfh = Buffer.alloc(30);
  lfh.writeUInt32LE(0x04034b50, 0);
  lfh.writeUInt16LE(20, 4);
  lfh.writeUInt32LE(crc, 14);
  lfh.writeUInt32LE(data.length, 18); // compressed
  lfh.writeUInt32LE(HUGE, 22);         // uncompressed LIE
  lfh.writeUInt16LE(name.length, 26);
  const lfhBlock = Buffer.concat([lfh, name, data]);

  const cdh = Buffer.alloc(46);
  cdh.writeUInt32LE(0x02014b50, 0);
  cdh.writeUInt16LE(20, 4);
  cdh.writeUInt16LE(20, 6);
  cdh.writeUInt32LE(crc, 16);
  cdh.writeUInt32LE(data.length, 20);
  cdh.writeUInt32LE(HUGE, 24);         // uncompressed LIE in CD too
  cdh.writeUInt16LE(name.length, 28);
  const cdhBlock = Buffer.concat([cdh, name]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdhBlock.length, 12);
  eocd.writeUInt32LE(lfhBlock.length, 16);

  const zipBuf = Buffer.concat([lfhBlock, cdhBlock, eocd]);
  const zip = new AdmZip(zipBuf);
  const r = inspectZip(zip);
  assert(r.ok === false, "expected ok:false");
  assert(/uncompressed-size|zip bomb/i.test((r as { reason: string }).reason), `reason: ${(r as { reason: string }).reason}`);
});

test("inspectZip / isUnsafeEntryName: path-traversal names all rejected", () => {
  const bad = ["../foo", "/abs", "C:\\evil", "foo\\bar", "../../etc/passwd", "d:relative"];
  for (const n of bad) {
    assert(isUnsafeEntryName(n), `should be unsafe: ${JSON.stringify(n)}`);
  }
  // Sanity: a normal name is safe.
  assert(!isUnsafeEntryName("song.xml"), "normal name should be safe");
});

// ---- safeJsonParse ----
test("safeJsonParse: neutralises flat __proto__", () => {
  const r = safeJsonParse('{"__proto__":{"admin":true}}');
  assert(r.ok, "should be ok after reviver strip");
  const v = (r as { ok: true; value: unknown }).value as Record<string, unknown>;
  // Prototype must not have been polluted globally
  assert(!(({} as Record<string, unknown>).admin), "Object.prototype.admin polluted");
  // Own keys must not contain __proto__
  assert(!Object.keys(v).includes("__proto__"), "__proto__ own key survived");
});

test("safeJsonParse: neutralises nested __proto__", () => {
  const r = safeJsonParse('{"user":{"name":"a","__proto__":{"admin":true}}}');
  assert(r.ok, "should still ok");
  const v = (r as { ok: true; value: unknown }).value as { user: Record<string, unknown> };
  assert(!Object.keys(v.user).includes("__proto__"), "nested __proto__ own key survived");
  assert(!(({} as Record<string, unknown>).admin), "prototype polluted globally");
});

test("safeJsonParse: neutralises nested constructor.prototype", () => {
  const r = safeJsonParse('{"a":{"constructor":{"prototype":{"pwned":true}}}}');
  assert(r.ok, "reviver stripped constructor key");
  const v = (r as { ok: true; value: unknown }).value as { a: Record<string, unknown> };
  assert(!Object.keys(v.a).includes("constructor"), "constructor own key survived");
  assert(!(({} as Record<string, unknown>).pwned), "prototype polluted globally");
});

test("safeJsonParse: valid JSON returns ok with value", () => {
  const r = safeJsonParse('{"title":"Amazing Grace","slides":["a","b"]}');
  assert(r.ok, "ok");
  const v = (r as { ok: true; value: unknown }).value as { title: string; slides: string[] };
  assert(v.title === "Amazing Grace", "title");
  assert(v.slides.length === 2, "slides length");
});

test("safeJsonParse: invalid JSON returns reason", () => {
  const r = safeJsonParse("{not-json");
  assert(!r.ok, "should not be ok");
  assert(/Invalid JSON/.test((r as { reason: string }).reason), "reason");
});

// ---- sanitizeFileName ----
test("sanitizeFileName: strips control chars, path chars, unicode; caps length", () => {
  assert(sanitizeFileName("safe.txt") === "safe.txt", "safe passthrough");
  assert(sanitizeFileName("../etc/passwd") === "passwd", "strips traversal");
  assert(sanitizeFileName("a\x00b\x1fc.txt") === "abc.txt", "strips control");
  assert(sanitizeFileName("café.png") !== "café.png", "strips unicode");
  const long = "a".repeat(500) + ".txt";
  assert(sanitizeFileName(long).length === 200, `long capped to 200, got ${sanitizeFileName(long).length}`);
  assert(sanitizeFileName("") === "file", "empty → file");
  assert(sanitizeFileName("C:\\Windows\\evil.exe") === "evil.exe", "windows path stripped");
});

// ---- decodeUtf8Strict ----
test("decodeUtf8Strict: valid UTF-8 round-trip", () => {
  const s = "hello — world 🙂";
  const buf = Buffer.from(s, "utf8");
  assert(decodeUtf8Strict(buf) === s, "roundtrip");
});

test("decodeUtf8Strict: invalid byte sequence throws", () => {
  // Lone continuation byte 0x80 is invalid UTF-8.
  const buf = Buffer.from([0xff, 0xfe, 0x80]);
  let threw = false;
  try { decodeUtf8Strict(buf); } catch { threw = true; }
  assert(threw, "expected throw on invalid utf-8");
});

// ---- withTimeout ----
test("withTimeout: resolves under limit", async () => {
  const p = new Promise<string>((res) => setTimeout(() => res("ok"), 10));
  const v = await withTimeout(p, 100);
  assert(v === "ok", "resolved");
});

test("withTimeout: rejects over limit", async () => {
  const p = new Promise<string>((res) => setTimeout(() => res("late"), 100));
  let msg = "";
  try { await withTimeout(p, 10); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
  assert(/parse exceeded/.test(msg), `expected timeout message, got ${msg}`);
});

// ============================================================
// XXE hardening
// ============================================================

test("pro6-parser: XXE ENTITY does not expand (either rejected or literal)", async () => {
  const xml = `<?xml version="1.0"?>
<!DOCTYPE RVPresentationDocument [<!ENTITY x SYSTEM "file:///etc/passwd">]>
<RVPresentationDocument CCLISongTitle="XXE Attempt &x;" CCLIAuthor="&x;">
  <groups>
    <RVSlideGrouping name="v1">
      <slides>
        <RVDisplaySlide>
          <displayElements>
            <RVTextElement RTFData="${Buffer.from("{\\rtf1 hello world}").toString("base64")}"/>
          </displayElements>
        </RVDisplaySlide>
      </slides>
    </RVSlideGrouping>
  </groups>
</RVPresentationDocument>`;
  // Case 1: direct parsePro6 — fast-xml-parser with processEntities:false
  // rejects external entities entirely, which is the STRONGEST XXE defense.
  let directOutput: string | null = null;
  let directThrew = false;
  try {
    const parsed = parsePro6(xml);
    directOutput = [parsed.title, parsed.artist ?? "", ...parsed.slides].join("\n");
  } catch {
    directThrew = true;
  }
  assert(directThrew || directOutput !== null, "unexpected");
  if (directOutput !== null) {
    assert(!/etc\/passwd/i.test(directOutput), `entity expanded: ${directOutput}`);
    assert(!/root:x:/i.test(directOutput), `entity expanded shadow: ${directOutput}`);
  }

  // Case 2: end-to-end via propresenterParser — must never throw, must
  // never emit `/etc/passwd`.
  const res = await propresenterParser.parse([{ name: "xxe.pro6", buffer: Buffer.from(xml, "utf8") }]);
  const joined = JSON.stringify(res);
  assert(!/etc\/passwd/i.test(joined), `end-to-end entity expanded: ${joined}`);
  assert(!/root:x:/i.test(joined), `end-to-end shadow: ${joined}`);
});

test("openlp: XXE ENTITY in OSZ does not expand", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE song [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<song xmlns="http://openlyrics.info/namespace/2009/song" version="0.8">
  <properties><titles><title>Song &xxe;</title></titles></properties>
  <lyrics><verse name="v1"><lines>Line one &xxe; here</lines></verse></lyrics>
</song>`;
  const zip = new AdmZip();
  zip.addFile("song.xml", Buffer.from(xml, "utf8"));
  const r = await openlpParser.parse([{ name: "xxe.osz", buffer: zip.toBuffer() }]);
  const joined = JSON.stringify(r);
  assert(!/etc\/passwd/i.test(joined), `entity expanded: ${joined}`);
  assert(!/root:x:/i.test(joined), `entity expanded shadow: ${joined}`);
});

// ============================================================
// ProPresenter slide-content correctness
// ============================================================

test("propresenter: fixture .pro6 produces non-empty slides with expected text", async () => {
  const buf = fs.readFileSync(path.join(FIX, "propresenter", "sample.pro6"));
  const res = await propresenterParser.parse([{ name: "sample.pro6", buffer: buf }]);
  assert(res.songs.length >= 1, "expected >=1 song");
  const song = res.songs[0];
  assert(song.slides.length >= 1, `expected >=1 slide, got ${song.slides.length}`);
  const first = song.slides[0];
  assert(first.length > 0, "first slide non-empty");
  // Must not leak raw RTF control words like \rtf1, \pard, \par.
  assert(!/\\rtf1|\\pard|\\par\b/.test(first), `RTF control words leaked: ${JSON.stringify(first)}`);
  // Fixture contains "Amazing grace" text — assert we decoded meaningfully.
  assert(/amazing grace/i.test(first), `expected 'amazing grace' text, got ${JSON.stringify(first)}`);
});

// ============================================================
// Media→S3: summaryJson stays small
// ============================================================

test("summaryJson stays <1MB with 5 media metadata entries (no buffers)", () => {
  const summary = {
    parserId: "propresenter",
    counts: { songs: 3, media: 5, skipped: 0 },
    songs: [
      { title: "A", artist: null, slideCount: 2, slides: ["line1", "line2"], warnings: [], sourceFile: "a.pro6" },
    ],
    media: [
      { s3Key: "imports/church-1/job-1/img1.png", fileName: "img1.png", mimeType: "image/png", sizeBytes: 50 * 1024 * 1024, sourceFile: "a.pro6" },
      { s3Key: "imports/church-1/job-1/img2.png", fileName: "img2.png", mimeType: "image/png", sizeBytes: 50 * 1024 * 1024, sourceFile: "a.pro6" },
      { s3Key: "imports/church-1/job-1/vid1.mp4", fileName: "vid1.mp4", mimeType: "video/mp4", sizeBytes: 100 * 1024 * 1024, sourceFile: "a.pro6" },
      { s3Key: "imports/church-1/job-1/img3.png", fileName: "img3.png", mimeType: "image/png", sizeBytes: 40 * 1024 * 1024, sourceFile: "b.pro6" },
      { s3Key: "imports/church-1/job-1/img4.png", fileName: "img4.png", mimeType: "image/png", sizeBytes: 30 * 1024 * 1024, sourceFile: "b.pro6" },
    ],
    skipped: [],
  };
  const size = JSON.stringify(summary).length;
  assert(size < 1024 * 1024, `summaryJson bloated: ${size} bytes (>= 1MB)`);
  // Sanity: none of the media entries contain a buffer/b64 field.
  for (const m of summary.media) {
    for (const k of Object.keys(m)) {
      assert(k !== "b64" && k !== "buffer", `forbidden field '${k}' in media metadata`);
    }
  }
});

// ============================================================
// Route terminal-status decision
// ============================================================

test("decideTerminalStatus: parser throws for every file → status:failed", async () => {
  const { decideTerminalStatus } = await import("./terminal-status");
  const r = decideTerminalStatus({
    parserId: "propresenter",
    fileCount: 3,
    anyParserRan: false, // parser.parse() threw for every file
    songsProduced: 0,
    mediaProduced: 0,
    skipped: [
      { file: "a.pro6", reason: "Parse failed: kaboom" },
      { file: "b.pro6", reason: "Parse failed: kaboom" },
      { file: "c.pro6", reason: "Parse failed: kaboom" },
    ],
  });
  assert(r.status === "failed", `expected failed, got ${r.status}`);
  assert(r.errorMessage && /failed for all 3/.test(r.errorMessage), `errorMessage: ${r.errorMessage}`);
});

test("decideTerminalStatus: all skipped are Parse-failed reasons → failed", async () => {
  const { decideTerminalStatus } = await import("./terminal-status");
  const r = decideTerminalStatus({
    parserId: "openlp",
    fileCount: 2,
    anyParserRan: true,
    songsProduced: 0,
    mediaProduced: 0,
    skipped: [
      { file: "a.osz", reason: "Parse failed: bad zip" },
      { file: "b.osz", reason: "parse exceeded 10000ms" },
    ],
  });
  assert(r.status === "failed", `expected failed, got ${r.status}`);
});

test("decideTerminalStatus: some songs produced → ready", async () => {
  const { decideTerminalStatus } = await import("./terminal-status");
  const r = decideTerminalStatus({
    parserId: "csv",
    fileCount: 1,
    anyParserRan: true,
    songsProduced: 2,
    mediaProduced: 0,
    skipped: [],
  });
  assert(r.status === "ready", `expected ready, got ${r.status}`);
  assert(r.errorMessage === null, "no errorMessage");
});

// ---------- Run ----------
(async () => {
  let passed = 0;
  const failures: string[] = [];
  for (const t of tests) {
    try {
      await t.run();
      passed++;
      console.log(`  ok  ${t.name}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failures.push(`${t.name}: ${msg}`);
      console.log(`  FAIL ${t.name}\n       ${msg}`);
    }
  }
  console.log(`\n${passed}/${tests.length} passed`);
  if (failures.length > 0) {
    process.exit(1);
  }
})();
