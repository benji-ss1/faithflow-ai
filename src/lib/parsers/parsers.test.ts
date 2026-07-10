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
