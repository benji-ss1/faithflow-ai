/**
 * Songs Library toolbar: the orange Add song button must always be visible, and ONE
 * Import window takes ProPresenter, VideoPsalm and EasyWorship / text files (the separate
 * VideoPsalm button crowded Add song off the edge of the panel — 2026-09-10 → 2026-09-19).
 * Run: npx tsx test/songs-toolbar.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
let pass = 0, fail = 0;
const check = (n: string, fn: () => void) => { try { fn(); console.log(`  PASS  ${n}`); pass++; } catch (e) { console.error(`  FAIL  ${n}\n        ${(e as Error).message}`); fail++; } };
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const songs = read("src/components/operator/pro/center/SongsBrowser.tsx");
const dialog = read("src/components/library/ProPresenterImportDialog.tsx");
const toolbar = songs.slice(songs.indexOf("{/* Song list */}"), songs.indexOf("{/* Bulk-select bar"));
const addDialog = songs.slice(songs.indexOf("function AddSongDialog"));

console.log("toolbar:");
check("Add song button is in the toolbar, labelled and orange", () => {
  assert.match(toolbar, /<AddSongDialog/);
  assert.match(addDialog, /Add song<\/button>|<Plus className="w-3\.5 h-3\.5" \/> Add song/);
  assert.match(addDialog, /bg-\[var\(--color-brand\)\]/);
});
check("Add song and Import can never be squeezed out: they don't shrink, the search box does", () => {
  assert.match(toolbar, /min-w-0 flex-1/);
  assert.match(addDialog, /shrink-0 h-8/);
  assert.match(toolbar, /"shrink-0 h-8 px-2/);
});
check("the separate VideoPsalm button and its hidden picker are gone", () => {
  assert.doesNotMatch(toolbar, /VideoPsalm<\/button>|> VideoPsalm\s*<\/button>/);
  assert.doesNotMatch(songs, /vpInputRef/);
});

console.log("one Import window:");
check("Import opens the shared import dialog with every-format support", () => {
  assert.match(songs, /<ProPresenterImportDialog[\s\S]*?onOtherFiles=\{\(fs\) => void importVideoPsalmFiles\(fs\)\}/);
});
check("dialog hands VideoPsalm / .txt / .ews files to the other importer, ProPresenter files carry on", () => {
  assert.match(dialog, /OTHER_SONG_FORMATS = \/\\\.\(vpagd\|txt\|ews\)\$\/i/);
  assert.match(dialog, /onOtherFiles\?\.\(other\)/);
  assert.match(dialog, /if \(arr\.length === 0\) \{ onClose\(\); return; \}/);
});
check("file picker accepts every format only in the merged mode", () => {
  // Intent: the non-ProPresenter formats (.vpagd/.txt/.ews) appear ONLY in the
  // merged branch. Deliberately NOT pinning the exact ProPresenter extension
  // list — that list grows (.proPlaylist, .prolib, .proLibrary were added
  // 2026-09-22) and pinning it made this test fail for a change it does not
  // actually guard.
  const accept = /accept=\{allFormats[\s\S]*?\}/.exec(dialog)?.[0] ?? "";
  assert.ok(accept, "accept={allFormats ...} not found");
  const [, merged = "", proOnly = ""] = /\?\s*"([^"]*)"\s*:\s*"([^"]*)"/.exec(accept) ?? [];
  for (const ext of [".vpagd", ".txt", ".ews"]) {
    assert.ok(merged.includes(ext), `merged mode should accept ${ext}`);
    assert.ok(!proOnly.includes(ext), `ProPresenter-only mode must NOT accept ${ext}`);
  }
  assert.ok(proOnly.includes(".proBundle") && proOnly.includes(".pro6"), "ProPresenter formats missing");
});
check("other callers of the dialog (ProPresenter-only) are unchanged", () => {
  assert.match(dialog, /onOtherFiles\?: \(files: File\[\]\) => void/);
  assert.match(dialog, /: "No ProPresenter files found\./);
});

console.log("Add song dialog:");
// 2026-09-24 (plan A.6): the dialog body moved to NewSongDialog.tsx (PP7 "New
// Presentation"); Filename replaces "Title", the theme is a real church theme.
const newSong = read("src/components/operator/pro/center/NewSongDialog.tsx");
check("still collects title, artist, theme, size, and seeds a first slide", () => {
  assert.match(addDialog, /<NewSongDialog/);
  for (const s of ["Filename:", "Artist:", "Theme:", "Size:", "Create a blank first slide ready to edit", "deps.createSong(fd)", 'fd.set("seedFirstSlide", "1")']) assert.ok(newSong.includes(s), s);
});
check("duplicate-title warning is in-app, not a native confirm() (Windows checklist #12)", () => {
  assert.doesNotMatch(addDialog, /window\.confirm/);
  assert.doesNotMatch(newSong, /window\.confirm/);
  assert.match(addDialog, /confirmDuplicate=\{\(t\) => confirm\(\{ title:/);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
