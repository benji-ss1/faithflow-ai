/**
 * Watched media folders — reconcile logic + the output-URL control.
 *
 * Run: npx tsx test/watched-folders.test.ts
 *
 * Two things are pinned here:
 *   1. The reconcile rules (what gets added, what gets un-filed, what is
 *      deliberately left alone).
 *   2. That the output URL sanitiser REJECTS `file:` — the measurement the
 *      whole "sync to S3, don't reference local disk" decision rests on
 *      (docs/WATCHED_MEDIA_FOLDERS.md, Decision 1). If that ever changed,
 *      the decision would deserve revisiting, so it should fail loudly.
 */
import assert from "node:assert";
import { reconcile, isSyncableFile, normalizeRelPath, describePlan, type DiskFile, type LibraryAsset } from "../src/lib/watched-folders";
import { cleanRenderUrl, isRenderableUrl } from "../src/lib/render-url";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n         ${(e as Error).message}`); fail++; }
}

const f = (relPath: string, size = 100): DiskFile => ({ absPath: `/w/${relPath}`, relPath, size });
const a = (id: string, sourceRelPath: string | null, size = 100): LibraryAsset =>
  ({ id, fileName: sourceRelPath?.split("/").pop() ?? id, sizeBytes: size, sourceRelPath });

console.log("\nWatched media folders\n");

// --- what counts as media ---------------------------------------------------

check("only media extensions sync", () => {
  for (const ok of ["a.jpg", "b.PNG", "c.mp4", "d.mov", "sub/e.webp"]) {
    assert.ok(isSyncableFile(ok), `${ok} should sync`);
  }
  for (const no of ["notes.txt", "song.pro", "a.mp3", "b.wav", "archive.zip", "noext"]) {
    assert.ok(!isSyncableFile(no), `${no} should NOT sync`);
  }
});

check("OS clutter and dotfiles are ignored", () => {
  for (const junk of [".DS_Store", "Thumbs.db", "desktop.ini", "._resourcefork.jpg", ".hidden.png"]) {
    assert.ok(!isSyncableFile(junk), `${junk} should be ignored`);
  }
});

check("audio is excluded on purpose", () => {
  // listMedia filters audio out of every surface except the Media Bin, so
  // syncing it would create assets that mostly cannot be used.
  assert.ok(!isSyncableFile("track.mp3"));
  assert.ok(!isSyncableFile("track.m4a"));
});

check("Windows separators normalise to one identity", () => {
  assert.strictEqual(normalizeRelPath("sub\\deep\\a.jpg"), "sub/deep/a.jpg");
  assert.strictEqual(normalizeRelPath("./a.jpg"), "a.jpg");
});

// --- the reconcile rules ----------------------------------------------------

check("a new file on disk is uploaded", () => {
  const plan = reconcile([f("a.jpg"), f("b.png")], []);
  assert.deepStrictEqual(plan.toUpload.map((x) => x.relPath), ["a.jpg", "b.png"]);
  assert.strictEqual(plan.toUnfile.length, 0);
});

check("a file already synced is left alone", () => {
  const plan = reconcile([f("a.jpg")], [a("1", "a.jpg")]);
  assert.strictEqual(plan.toUpload.length, 0);
  assert.strictEqual(plan.toUnfile.length, 0);
  assert.strictEqual(plan.unchanged, 1);
});

check("a file that vanished is UN-FILED, and reported as such", () => {
  const plan = reconcile([], [a("1", "gone.jpg")]);
  assert.deepStrictEqual(plan.toUnfile.map((x) => x.id), ["1"]);
  // The plan must never express a delete — un-filing is the only removal.
  assert.ok(!("toDelete" in plan), "reconcile must not produce deletions");
});

check("a hand-added asset (no source path) is NEVER un-filed", () => {
  // Dragged in by the operator before the folder was watched — not ours.
  const plan = reconcile([], [a("1", null)]);
  assert.strictEqual(plan.toUnfile.length, 0);
});

check("identity is the RELATIVE PATH, so same-named files in sub-folders coexist", () => {
  const plan = reconcile([f("a.jpg"), f("sub/a.jpg")], [a("1", "a.jpg")]);
  assert.deepStrictEqual(plan.toUpload.map((x) => x.relPath), ["sub/a.jpg"]);
  assert.strictEqual(plan.toUnfile.length, 0);
});

check("a renamed display name does not break the link to its source", () => {
  const asset: LibraryAsset = { id: "1", fileName: "Sunday Background", sizeBytes: 100, sourceRelPath: "a.jpg" };
  const plan = reconcile([f("a.jpg")], [asset]);
  assert.strictEqual(plan.toUpload.length, 0, "renaming in-app must not re-upload");
  assert.strictEqual(plan.toUnfile.length, 0, "renaming in-app must not un-file");
});

check("a file whose size changed is deliberately NOT re-uploaded", () => {
  // Re-uploading would mint a second asset while the first is still referenced
  // by service plans, themes and slides.
  const plan = reconcile([f("a.jpg", 999)], [a("1", "a.jpg", 100)]);
  assert.strictEqual(plan.toUpload.length, 0);
  assert.strictEqual(plan.toUnfile.length, 0);
});

check("an empty folder un-files everything but destroys nothing", () => {
  const plan = reconcile([], [a("1", "a.jpg"), a("2", "b.png")]);
  assert.strictEqual(plan.toUnfile.length, 2);
  assert.strictEqual(plan.toUpload.length, 0);
});

check("non-media files in the folder are ignored, not uploaded", () => {
  const plan = reconcile([f("notes.txt"), f("a.jpg"), f(".DS_Store")], []);
  assert.deepStrictEqual(plan.toUpload.map((x) => x.relPath), ["a.jpg"]);
});

check("duplicate relPaths from the walker import once", () => {
  const plan = reconcile([f("a.jpg"), f("a.jpg")], []);
  assert.strictEqual(plan.toUpload.length, 1);
});

check("upload order is stable", () => {
  const plan = reconcile([f("c.jpg"), f("a.jpg"), f("b.jpg")], []);
  assert.deepStrictEqual(plan.toUpload.map((x) => x.relPath), ["a.jpg", "b.jpg", "c.jpg"]);
});

check("describePlan is honest when there is nothing to do", () => {
  assert.match(describePlan(reconcile([f("a.jpg")], [a("1", "a.jpg")])), /up to date/i);
  assert.match(describePlan(reconcile([f("b.jpg")], [])), /1 to add/);
});

// --- the control the whole design rests on ---------------------------------

check("CONTROL: the output sanitiser rejects file: and bare local paths", () => {
  for (const local of [
    "file:///Users/me/clip.mp4",
    "file://C:/media/bg.jpg",
    "/Users/me/clip.mp4",
    "C:\\media\\bg.jpg",
  ]) {
    assert.strictEqual(cleanRenderUrl(local), null, `cleanRenderUrl accepted ${local}`);
    assert.strictEqual(isRenderableUrl(local), false, `isRenderableUrl accepted ${local}`);
  }
  // Sanity: a real https URL still passes, so the test is not vacuous.
  assert.strictEqual(isRenderableUrl("https://example.com/a.jpg"), true);
});

// --- fixes from the 2026-09-25 adversarial review ---------------------------

check("REVIEW FIX: unicode NFD and NFC are the SAME file (macOS stores NFD)", () => {
  const nfd = "cafe\u0301.jpg";      // e + combining acute — what macOS returns
  const nfc = "caf\u00e9.jpg";       // single codepoint — what a round-trip gives
  assert.notStrictEqual(nfd, nfc, "precondition: these strings differ");
  const plan = reconcile([f(nfd)], [a("1", nfc)]);
  assert.strictEqual(plan.toUpload.length, 0, "re-uploaded the same file forever");
  assert.strictEqual(plan.toUnfile.length, 0, "un-filed a file that is present");
});

check("REVIEW FIX: a case-only rename is the SAME file on mac/Windows", () => {
  const plan = reconcile([f("Photo.JPG")], [a("1", "photo.jpg")]);
  assert.strictEqual(plan.toUpload.length, 0, "duplicated on a case-only rename");
  assert.strictEqual(plan.toUnfile.length, 0);
});

check("REVIEW FIX: the stored spelling is the operator's, not the folded key", () => {
  const plan = reconcile([f("Sunday Morning.JPG")], []);
  assert.strictEqual(plan.toUpload[0].relPath, "Sunday Morning.JPG");
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
