/**
 * Fonts P1 — bundled files: every registry face × weight × style has a woff2 and
 * an @font-face; OFL present; size cap; Yoruba/Igbo cmap flags match the files.
 * Parses the WOFF2 table directory + brotli stream with node:zlib (the cmap
 * table is never transformed), so no font-parsing dependency is needed.
 * Run: npx tsx test/fonts-files.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { FONT_REGISTRY } from "../src/lib/fonts/registry";

const ROOT = path.resolve(__dirname, "..");
const CSS = fs.readFileSync(path.join(ROOT, "src/app/slide-fonts.css"), "utf8");
const MAX_FILE_BYTES = 200 * 1024;
const MAX_TOTAL_BYTES = 3 * 1024 * 1024;

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name} — ${(e as Error).message}`); fail++; }
}

type Face = { family: string; style: string; wmin: number; wmax: number; url: string };
const faces: Face[] = [];
for (const m of CSS.matchAll(/@font-face\s*{([^}]*)}/g)) {
  const b = m[1];
  const family = /font-family:\s*"([^"]+)"/.exec(b)![1];
  const style = /font-style:\s*(\w+)/.exec(b)![1];
  const w = /font-weight:\s*(\d+)(?:\s+(\d+))?/.exec(b)!;
  const url = /url\("([^"]+)"\)/.exec(b)![1];
  faces.push({ family, style, wmin: +w[1], wmax: +(w[2] ?? w[1]), url });
}

function cmapOf(file: string): Set<number> {
  const buf = fs.readFileSync(file);
  assert.equal(buf.toString("ascii", 0, 4), "wOF2", "woff2 signature");
  const numTables = buf.readUInt16BE(12);
  let off = 48;
  const readBase128 = () => { let v = 0; for (let i = 0; i < 5; i++) { const b = buf[off++]; v = (v << 7) | (b & 0x7f); if (!(b & 0x80)) return v >>> 0; } throw new Error("bad base128"); };
  const KNOWN = ["cmap","head","hhea","hmtx","maxp","name","OS/2","post","cvt ","fpgm","glyf","loca","prep","CFF ","VORG","EBDT","EBLC","gasp","hdmx","kern","LTSH","PCLT","VDMX","vhea","vmtx","BASE","GDEF","GPOS","GSUB","EBSC","JSTF","MATH","CBDT","CBLC","COLR","CPAL","SVG ","sbix","acnt","avar","bdat","bloc","bsln","cvar","fdsc","feat","fmtx","fvar","gvar","hsty","just","lcar","mort","morx","opbd","prop","trak","Zapf","Silf","Glat","Gloc","Feat","Sill"];
  const tables: { tag: string; offset: number; length: number }[] = [];
  let dataOff = 0;
  for (let i = 0; i < numTables; i++) {
    const flags = buf[off++];
    const tag = (flags & 0x3f) === 63 ? buf.toString("ascii", off, (off += 4)) : KNOWN[flags & 0x3f];
    const version = (flags >> 6) & 3;
    const orig = readBase128();
    const transformed = (tag === "glyf" || tag === "loca") ? version === 0 : version !== 0;
    const length = transformed ? readBase128() : orig;
    tables.push({ tag, offset: dataOff, length });
    dataOff += length;
  }
  const compLen = buf.readUInt32BE(20);
  const data = zlib.brotliDecompressSync(buf.subarray(off, off + compLen));
  const t = tables.find((x) => x.tag === "cmap");
  assert.ok(t, "cmap table");
  const cmap = data.subarray(t!.offset, t!.offset + t!.length);
  const cps = new Set<number>();
  const n = cmap.readUInt16BE(2);
  for (let i = 0; i < n; i++) {
    const sub = cmap.readUInt32BE(4 + i * 8 + 4);
    const fmt = cmap.readUInt16BE(sub);
    if (fmt === 4) {
      const segX2 = cmap.readUInt16BE(sub + 6);
      for (let s = 0; s < segX2; s += 2) {
        const end = cmap.readUInt16BE(sub + 14 + s), start = cmap.readUInt16BE(sub + 16 + segX2 + s);
        for (let c = start; c <= end && c !== 0xffff; c++) cps.add(c);
      }
    } else if (fmt === 12) {
      const groups = cmap.readUInt32BE(sub + 12);
      for (let g = 0; g < groups; g++) {
        const start = cmap.readUInt32BE(sub + 16 + g * 12), end = cmap.readUInt32BE(sub + 20 + g * 12);
        for (let c = start; c <= end; c++) cps.add(c);
      }
    }
  }
  return cps;
}

const YORUBA = [0x1eb9, 0x1ecd, 0x1e63, 0x1eb8, 0x1ecc, 0x1e62, 0x300, 0x301, 0xe0, 0xe9, 0xf2];
const IGBO = [0x1ecb, 0x1ee5, 0x1e45, 0x1eca, 0x1ee4, 0x1e44];

let total = 0;
for (const e of FONT_REGISTRY.filter((x) => x.bundled)) {
  check(`${e.family}: OFL.txt present and is SIL OFL`, () => {
    const t = fs.readFileSync(path.join(ROOT, "public/fonts", e.id, "OFL.txt"), "utf8");
    assert.match(t, /SIL OPEN FONT LICENSE/i);
  });
  for (const style of e.italic ? ["normal", "italic"] : ["normal"]) {
    for (const w of e.weights) {
      check(`${e.family} ${w} ${style}: @font-face + file`, () => {
        const f = faces.find((x) => x.family === e.family && x.style === style && x.wmin <= w && w <= x.wmax);
        assert.ok(f, "no @font-face covers it");
        assert.ok(f!.url.startsWith(`/fonts/${e.id}/`), f!.url);
        assert.ok(fs.existsSync(path.join(ROOT, "public", f!.url)), `missing ${f!.url}`);
      });
    }
  }
  const own = faces.filter((x) => x.family === e.family);
  check(`${e.family}: files ≤ ${MAX_FILE_BYTES / 1024}KB, cmap flags match registry`, () => {
    assert.ok(own.length > 0);
    for (const f of own) {
      const p = path.join(ROOT, "public", f.url);
      const size = fs.statSync(p).size; total += size;
      assert.ok(size <= MAX_FILE_BYTES, `${f.url} ${size}`);
      const cps = cmapOf(p);
      assert.ok(cps.has(0x41) && cps.has(0x7a), "basic latin");
      assert.equal(YORUBA.every((c) => cps.has(c)), e.supports.yoruba, `${f.url} yoruba flag`);
      assert.equal(IGBO.every((c) => cps.has(c)), e.supports.igbo, `${f.url} igbo flag`);
    }
  });
}
check("no @font-face for a family outside the registry; no stray css urls", () => {
  for (const f of faces) assert.ok(FONT_REGISTRY.some((e) => e.bundled && e.family === f.family), f.family);
  assert.ok(!/https?:/.test(CSS.replace(/\/\*[\s\S]*?\*\//g, "")), "no absolute urls");
  assert.ok(/font-display:\s*swap/.test(CSS));
});
check(`total bundled font bytes ≤ ${MAX_TOTAL_BYTES / 1024 / 1024}MB`, () => assert.ok(total <= MAX_TOTAL_BYTES, String(total)));
check("layout imports slide-fonts.css", () => {
  assert.match(fs.readFileSync(path.join(ROOT, "src/app/layout.tsx"), "utf8"), /import "\.\/slide-fonts\.css";/);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
