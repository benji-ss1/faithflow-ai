/**
 * Proclaim import order — the ZIP/.proclaim archive must import songs in the
 * service `manifest.json` items[] order, not ZIP-directory (alphabetical) order.
 *
 * Run: npx tsx test/proclaim-order.test.ts
 */
import assert from "node:assert";
import AdmZip from "adm-zip";
import { proclaimParser } from "../src/lib/parsers/proclaim";

const song = (t: string) =>
  Buffer.from(JSON.stringify({ type: "song", title: t, stanzas: [{ text: `${t} line one` }] }));

let pass = 0, fail = 0;
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name} — ${(e as Error).message}`); fail++; }
}

(async () => {
  await check("orders songs by manifest.json items[] (not alphabetical)", async () => {
    const zip = new AdmZip();
    zip.addFile("a.json", song("Alpha")); // alphabetically first...
    zip.addFile("b.json", song("Beta"));
    zip.addFile("manifest.json", Buffer.from(JSON.stringify({ kind: "presentation", items: ["b.json", "a.json"] })));
    const res = await proclaimParser.parse([{ name: "svc.proclaim", buffer: zip.toBuffer() }]);
    assert.deepStrictEqual(res.songs.map((s) => s.title), ["Beta", "Alpha"], JSON.stringify(res.songs.map((s) => s.title)));
  });

  await check("appends entries NOT listed in the manifest (never drops content)", async () => {
    const zip = new AdmZip();
    zip.addFile("a.json", song("Alpha"));
    zip.addFile("b.json", song("Beta"));
    zip.addFile("c.json", song("Gamma")); // not in manifest
    zip.addFile("manifest.json", Buffer.from(JSON.stringify({ items: ["b.json", "a.json"] })));
    const res = await proclaimParser.parse([{ name: "svc.proclaim", buffer: zip.toBuffer() }]);
    assert.deepStrictEqual(res.songs.map((s) => s.title), ["Beta", "Alpha", "Gamma"], JSON.stringify(res.songs.map((s) => s.title)));
  });

  await check("no manifest → falls back to archive order (safe)", async () => {
    const zip = new AdmZip();
    zip.addFile("a.json", song("Alpha"));
    zip.addFile("b.json", song("Beta"));
    const res = await proclaimParser.parse([{ name: "svc2.proclaim", buffer: zip.toBuffer() }]);
    const titles = res.songs.map((s) => s.title).sort();
    assert.deepStrictEqual(titles, ["Alpha", "Beta"], JSON.stringify(titles));
  });

  console.log(`\n=== proclaim-order: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exit(1);
})();
