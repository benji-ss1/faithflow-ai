/**
 * OS file drop → Media Bin classification. Pure routing of dropped files.
 * Run: npx tsx test/media-bin-drop.test.ts
 */
import assert from "node:assert/strict";
import {
  isOsFileDrag, classifyDroppedFile, fileExtension, skippedSummary,
  MEDIA_BIN_MAX_BYTES, MEDIA_BIN_VIDEO_MAX_BYTES,
} from "../src/lib/media-bin-drop";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}
const f = (name: string, type = "", size = 1000) => ({ name, type, size });

check("OS Finder/Explorer drag is recognised", () => {
  assert.equal(isOsFileDrag(["Files"]), true);
});
check("in-app media tile drag is NOT an OS file drag (no regression)", () => {
  assert.equal(isOsFileDrag(["application/x-pf-library-item"]), false);
  assert.equal(isOsFileDrag(["application/x-pf-library-item", "Files"]), false);
  assert.equal(isOsFileDrag(["application/x-pf-library-items", "Files"]), false);
});
check("text / slide drags are not OS file drags", () => {
  assert.equal(isOsFileDrag(["text/plain"]), false);
  assert.equal(isOsFileDrag(["application/x-presentflow-slide"]), false);
  assert.equal(isOsFileDrag(null), false);
});

check("images by extension with EMPTY OS type (Windows)", () => {
  assert.deepEqual(classifyDroppedFile(f("a.PNG")), { route: "image", contentType: "image/png" });
  assert.deepEqual(classifyDroppedFile(f("b.jpeg")), { route: "image", contentType: "image/jpeg" });
  assert.deepEqual(classifyDroppedFile(f("c.webp")), { route: "image", contentType: "image/webp" });
});
check("videos by extension with empty type (.mov on Windows)", () => {
  assert.deepEqual(classifyDroppedFile(f("clip.MOV")), { route: "video", contentType: "video/quicktime" });
  assert.deepEqual(classifyDroppedFile(f("x.mp4")), { route: "video", contentType: "video/mp4" });
});
check("MIME fallback when there's no extension", () => {
  assert.deepEqual(classifyDroppedFile(f("screenshot", "image/png")), { route: "image", contentType: "image/png" });
  assert.deepEqual(classifyDroppedFile(f("dl", "video/webm")), { route: "video", contentType: "video/webm" });
});
check("PowerPoint / PDF → deck (wizard)", () => {
  assert.equal(classifyDroppedFile(f("Sunday.pptx")).route, "deck");
  assert.equal(classifyDroppedFile(f("old.ppt")).route, "deck");
  assert.equal(classifyDroppedFile(f("notes.pdf")).route, "deck");
  assert.equal(classifyDroppedFile(f("noext", "application/pdf")).route, "deck");
});
check("ProPresenter → pro (wizard)", () => {
  assert.equal(classifyDroppedFile(f("song.pro6")).route, "pro");
  assert.equal(classifyDroppedFile(f("song.pro")).route, "pro");
});
check("supported audio → upload with canonical MIME (empty OS type too)", () => {
  assert.deepEqual(classifyDroppedFile(f("worship.mp3")), { route: "audio", contentType: "audio/mpeg" });
  assert.deepEqual(classifyDroppedFile(f("x.WAV")), { route: "audio", contentType: "audio/wav" });
  assert.deepEqual(classifyDroppedFile(f("x.m4a")), { route: "audio", contentType: "audio/mp4" });
  assert.deepEqual(classifyDroppedFile(f("x.aac")), { route: "audio", contentType: "audio/aac" });
  assert.deepEqual(classifyDroppedFile(f("x", "audio/mpeg")), { route: "audio", contentType: "audio/mpeg" });
  assert.deepEqual(classifyDroppedFile(f("x", "audio/x-m4a")), { route: "audio", contentType: "audio/mp4" });
});
check("other audio formats → honest format message, never silently dropped", () => {
  assert.equal(classifyDroppedFile(f("x.flac")).route, "audio-format");
  assert.equal(classifyDroppedFile(f("x.ogg")).route, "audio-format");
  assert.equal(classifyDroppedFile(f("x", "audio/ogg")).route, "audio-format");
  assert.equal(classifyDroppedFile(f("big.mp3", "", MEDIA_BIN_MAX_BYTES + 1)).route, "too-large");
});
check("HEIC/HEIF → image (converted to JPEG before upload)", () => {
  assert.deepEqual(classifyDroppedFile(f("IMG_0001.HEIC")), { route: "image", contentType: "image/jpeg", heic: true });
  assert.deepEqual(classifyDroppedFile(f("a.heif")), { route: "image", contentType: "image/jpeg", heic: true });
  assert.deepEqual(classifyDroppedFile(f("x", "image/heic")), { route: "image", contentType: "image/jpeg", heic: true });
  assert.equal(classifyDroppedFile(f("IMG.heic", "", 0)).route, "empty");
});
check("SVG and unknown types are unsupported (SVG XSS exclusion kept)", () => {
  assert.equal(classifyDroppedFile(f("logo.svg", "image/svg+xml")).route, "unsupported");
  assert.equal(classifyDroppedFile(f("a.zip")).route, "unsupported");
  assert.equal(classifyDroppedFile(f("readme.txt", "text/plain")).route, "unsupported");
});
check("empty and oversize files are rejected with a reason", () => {
  assert.equal(classifyDroppedFile(f("a.png", "", 0)).route, "empty");
  // Large videos now go through multipart: 600 MB is fine, >5 GB is not.
  assert.deepEqual(classifyDroppedFile(f("big.mp4", "", MEDIA_BIN_MAX_BYTES + 1)), { route: "video", contentType: "video/mp4" });
  assert.deepEqual(classifyDroppedFile(f("huge.mp4", "", MEDIA_BIN_VIDEO_MAX_BYTES + 1)), { route: "too-large", limitMb: 5120 });
  assert.deepEqual(classifyDroppedFile(f("big.png", "", MEDIA_BIN_MAX_BYTES + 1)), { route: "too-large", limitMb: 500 });
  assert.deepEqual(classifyDroppedFile(f("big.pptx", "", 151 * 1024 * 1024)), { route: "too-large", limitMb: 150 });
  assert.equal(classifyDroppedFile(f("big.pdf", "", 400 * 1024 * 1024)).route, "deck");
});
check("fileExtension edge cases", () => {
  assert.equal(fileExtension("a.b.JPG"), "jpg");
  assert.equal(fileExtension("noext"), "");
  assert.equal(fileExtension(".hidden"), "hidden");
});
check("skippedSummary groups reasons; null when nothing skipped", () => {
  assert.equal(skippedSummary([]), null);
  const s = skippedSummary([{ name: "a.flac", route: "audio-format" }, { name: "b.ogg", route: "audio-format" }, { name: "c.svg", route: "unsupported" }])!;
  assert.match(s, /2 files: that audio format/);
  assert.match(s, /“c.svg”: not a supported type/);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
