/**
 * ProPresenter .proPlaylist (and sibling ZIP containers) — import regression.
 *
 * Run: npx tsx test/propresenter-playlist-import.test.ts
 *
 * WHY THIS EXISTS
 *   A real Kings Court export ("Sept 20.proPlaylist", 7 songs) imported ZERO
 *   songs. The parsers were never at fault — the same bytes renamed to `.zip`
 *   imported all 7 correctly. The bug was purely the container gate in
 *   `expandProBundles`, which only unzipped `.proBundle` / `.zip`, so a
 *   `.proPlaylist` fell through to the per-file parsers and matched none.
 *
 *   These tests lock the container gate AND the slide line-break fidelity fix
 *   so neither can silently regress.
 *
 * NOTE ON FIXTURES
 *   CLAUDE.md rule 11 forbids committing real worship lyrics to the repo, so
 *   every fixture here is synthetic protobuf built in-process — never the
 *   church's actual content.
 */
import assert from "node:assert";
import AdmZip from "adm-zip";
import { runImportPipeline, expandProBundles } from "../src/lib/importers/pipeline";
import { parsePlaylistManifest, orderByManifest } from "../src/lib/propresenter-manifest";

// --- minimal protobuf encoder (mirrors test/propresenter-import.test.ts) ----
function pbVarint(n: number): Buffer {
  const out: number[] = [];
  while (n > 0x7f) { out.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
  out.push(n);
  return Buffer.from(out);
}
function pbLD(field: number, payload: Buffer): Buffer {
  return Buffer.concat([pbVarint((field << 3) | 2), pbVarint(payload.length), payload]);
}

/**
 * Build a synthetic .pro doc. Uses `{\rtf0` deliberately: the real Kings
 * Court files emit rtf0, not the rtf1 the older fixtures assume.
 */
function makePro(slides: string[]): Buffer {
  const cues = slides.map((text, i) =>
    pbLD(13, Buffer.concat([
      pbLD(1, Buffer.from(`0000000${i}-0000-0000-0000-00000000000${i}`)),
      pbLD(5, Buffer.from(`{\\rtf0\\ansi\\ansicpg1252\\f0\\fs200 ${text}}`, "utf8")),
    ])),
  );
  return Buffer.concat(cues);
}

/** Mirror the real container: several .pro docs + a `data` manifest + folders. */
function makePlaylist(entries: Record<string, string[]>): Buffer {
  const zip = new AdmZip();
  for (const [name, slides] of Object.entries(entries)) {
    zip.addFile(`${name}.pro`, makePro(slides));
  }
  zip.addFile("data", Buffer.from([0x0a, 0x28, 0x08, 0x02])); // protobuf manifest stub
  zip.addFile("Media/", Buffer.alloc(0));
  zip.addFile("PDF/", Buffer.alloc(0));
  return zip.toBuffer();
}

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n         ${(e as Error).message}`); fail++; }
}

const FIXTURE = makePlaylist({
  "Song Alpha": ["Line one\\par\\pard\\li0 Line two\\par\\pard\\li0 Line three"],
  "Song Beta": ["Beta first slide", "Beta second slide"],
  "Song Gamma": ["Gamma only"],
});

console.log("\nProPresenter .proPlaylist import\n");

check(".proPlaylist is recognised as a ZIP container and expanded", () => {
  const { files } = expandProBundles([{ path: "Sept 20.proPlaylist", contents: FIXTURE }]);
  const pros = files.filter((f) => f.path.endsWith(".pro"));
  assert.strictEqual(pros.length, 3, `expected 3 .pro members, got ${pros.length}`);
  // Container extension must be stripped from the synthesized folder prefix.
  assert.ok(pros.every((f) => f.path.startsWith("Sept 20/")), JSON.stringify(pros.map((f) => f.path)));
});

check(".proPlaylist imports every song end to end", () => {
  const out = runImportPipeline([{ path: "Sept 20.proPlaylist", contents: FIXTURE }]);
  assert.strictEqual(out.songs.length, 3, `expected 3 songs, got ${out.songs.length}`);
  const titles = out.songs.map((s) => s.title).sort();
  assert.deepStrictEqual(titles, ["Song Alpha", "Song Beta", "Song Gamma"]);
});

check("the `data` manifest + empty Media/PDF folders do not become songs", () => {
  const out = runImportPipeline([{ path: "Sept 20.proPlaylist", contents: FIXTURE }]);
  assert.ok(!out.songs.some((s) => /^(data|Media|PDF)$/i.test(s.title)),
    `manifest leaked in as a song: ${JSON.stringify(out.songs.map((s) => s.title))}`);
});

check("slide line breaks survive (\\par must NOT collapse to spaces)", () => {
  const out = runImportPipeline([{ path: "x.proPlaylist", contents: FIXTURE }]);
  const alpha = out.songs.find((s) => s.title === "Song Alpha");
  assert.ok(alpha, "Song Alpha missing");
  assert.strictEqual(alpha!.slides[0], "Line one\nLine two\nLine three",
    `line breaks lost: ${JSON.stringify(alpha!.slides[0])}`);
});

check("sibling containers (.prolib / .protheme) expand too", () => {
  for (const ext of [".prolib", ".proLibrary", ".protheme", ".proThemeBundle"]) {
    const { files } = expandProBundles([{ path: `Lib${ext}`, contents: FIXTURE }]);
    assert.ok(files.filter((f) => f.path.endsWith(".pro")).length === 3, `${ext} did not expand`);
  }
});

check("NO REGRESSION: .proBundle and .zip still expand exactly as before", () => {
  for (const name of ["Sept 20.proBundle", "Sept 20.zip"]) {
    const out = runImportPipeline([{ path: name, contents: FIXTURE }]);
    assert.strictEqual(out.songs.length, 3, `${name} regressed: ${out.songs.length} songs`);
  }
});

check("a non-ZIP file with a container extension is ignored, never thrown on", () => {
  const junk = Buffer.from("this is not a zip at all", "utf8");
  const out = runImportPipeline([{ path: "broken.proPlaylist", contents: junk }]);
  assert.strictEqual(out.songs.length, 0);
});

check("an empty .proPlaylist yields no songs and does not throw", () => {
  const out = runImportPipeline([{ path: "empty.proPlaylist", contents: new AdmZip().toBuffer() }]);
  assert.strictEqual(out.songs.length, 0);
});

// --- playlist manifest (`data`) -------------------------------------------
//
// Mirrors the real nesting: playlist node (title + items), each item holding
// a title and a document-reference subtree whose OWN field #2 is a path.
// That inner path is exactly what made a naive walk report paths as titles.
function manifestItem(title: string, proPath: string, uuid: string): Buffer {
  const docRef = pbLD(4, pbLD(1, Buffer.concat([
    pbLD(1, Buffer.from(`C:\\Users\\X\\${proPath.replace(/\//g, "\\")}`, "utf8")),
    pbLD(4, pbLD(2, Buffer.from(proPath, "utf8"))),
  ])));
  return pbLD(13, Buffer.concat([
    pbLD(1, pbLD(1, Buffer.from(uuid, "utf8"))),
    pbLD(2, Buffer.from(title, "utf8")),
    docRef,
  ]));
}
function makeManifest(name: string, items: [string, string][]): Buffer {
  const body = Buffer.concat([
    pbLD(2, Buffer.from(name, "utf8")),
    ...items.map(([t, p], i) => manifestItem(t, p, `0000000${i}-0000-0000-0000-00000000000${i}`)),
  ]);
  return pbLD(3, pbLD(12, pbLD(1, body)));
}

const MANIFEST = makeManifest("Sept 20", [
  ["Halle intro", "Libraries/Default/Halle intro.pro"],
  ["Song of Ages", "Libraries/Default/Song of Ages.pro"],
  ["Dependable Jesus", "Libraries/Default/Dependable Jesus.pro"],
]);

check("manifest: playlist name and items parse in service order", () => {
  const m = parsePlaylistManifest(MANIFEST);
  assert.strictEqual(m.name, "Sept 20");
  assert.deepStrictEqual(m.items.map((i) => i.title),
    ["Halle intro", "Song of Ages", "Dependable Jesus"]);
});

check("manifest: a document PATH is never reported as a title", () => {
  const m = parsePlaylistManifest(MANIFEST);
  for (const it of m.items) {
    assert.ok(!/[/\\]/.test(it.title) && !/\.pro$/i.test(it.title),
      `path leaked as title: ${JSON.stringify(it.title)}`);
    assert.ok(it.sourcePath && /\.pro$/i.test(it.sourcePath), "sourcePath missing");
  }
});

check("manifest: garbage and empty input never throw", () => {
  for (const b of [Buffer.alloc(0), Buffer.from("not protobuf at all"), Buffer.from([0xff, 0xff, 0xff])]) {
    const m = parsePlaylistManifest(b);
    assert.ok(Array.isArray(m.items));
  }
});

check("orderByManifest reorders known songs and NEVER drops unknown ones", () => {
  const m = parsePlaylistManifest(MANIFEST);
  const songs = ["Dependable Jesus", "Unlisted Extra", "Halle intro", "Song of Ages"];
  const ordered = orderByManifest(songs, m, (t) => t);
  assert.deepStrictEqual(ordered, ["Halle intro", "Song of Ages", "Dependable Jesus", "Unlisted Extra"]);
});

check("orderByManifest is a no-op when the manifest is empty", () => {
  const songs = ["b", "a", "c"];
  assert.deepStrictEqual(orderByManifest(songs, { name: null, items: [], warnings: [] }, (t) => t), songs);
});

check("end-to-end: a playlist with a manifest imports in SERVICE order", () => {
  const zip = new AdmZip();
  zip.addFile("Halle intro.pro", makePro(["halle"]));
  zip.addFile("Song of Ages.pro", makePro(["ages"]));
  zip.addFile("Dependable Jesus.pro", makePro(["dep"]));
  zip.addFile("data", MANIFEST);
  const out = runImportPipeline([{ path: "Sept 20.proPlaylist", contents: zip.toBuffer() }]);
  // ZIP/alphabetical order would be Dependable, Halle, Song — assert it is NOT that.
  assert.deepStrictEqual(out.songs.map((s) => s.title),
    ["Halle intro", "Song of Ages", "Dependable Jesus"]);
  assert.deepStrictEqual(out.playlist, { name: "Sept 20", itemCount: 3 });
});

check("NO REGRESSION: a container with NO manifest still imports (file order)", () => {
  const out = runImportPipeline([{ path: "Sept 20.proPlaylist", contents: FIXTURE }]);
  assert.strictEqual(out.songs.length, 3);
  assert.strictEqual(out.playlist, null, "playlist must be null without a manifest");
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
