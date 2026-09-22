/**
 * Windows parity: a Mac-exported video must never be a silent black screen on a
 * Windows church's projector.
 *
 * `.mov` is an allowed upload and Mac/iPhone exports are usually HEVC (H.265),
 * which stock Chromium on Windows cannot decode. It plays perfectly on the Mac
 * it was made on. Many of our churches are on Windows.
 *
 * Run: npx tsx test/windows-media.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { probeVideoCodec, uploadCodecWarning, playbackFailureMessage, CODEC_PROBE_BYTES, canPlayHevcHere } from "../src/lib/video-codec";
import { reportMediaFailure, resetMediaFailureLog, MEDIA_FAILURE_EVENT } from "../src/lib/media-failure";

let pass = 0, fail = 0;
const check = (n: string, fn: () => void) => {
  try { fn(); console.log(`  PASS  ${n}`); pass++; }
  catch (e) { console.error(`  FAIL  ${n}\n        ${(e as Error).message}`); fail++; }
};
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
// Build a fake MP4 header containing a fourcc, the way a real file carries it.
const withFourcc = (cc: string) => new TextEncoder().encode(`\0\0\0 ftypqt  \0\0\0\0${cc}moovtrak`);

console.log("HEVC is detected from the file header:");
check("hvc1 / hev1 / hvcC all read as HEVC", () => {
  for (const cc of ["hvc1", "hev1", "hvcC"]) assert.equal(probeVideoCodec(withFourcc(cc)), "hevc", cc);
});
check("H.264 is not mistaken for HEVC", () => {
  assert.equal(probeVideoCodec(withFourcc("avc1")), "h264");
  assert.equal(probeVideoCodec(withFourcc("avcC")), "h264");
});
check("an unreadable header returns 'unknown' and stays SILENT", () => {
  assert.equal(probeVideoCodec(new Uint8Array(0)), "unknown");
  assert.equal(probeVideoCodec(new Uint8Array([1, 2, 3])), "unknown");
  assert.equal(uploadCodecWarning("unknown"), null, "we must not cry wolf on a file we could not read");
});

console.log("the operator is warned where it matters:");
check("HEVC warns, and the warning names Windows and the fix", () => {
  const w = uploadCodecWarning("hevc");
  assert.ok(w);
  assert.match(w!, /Windows/);
  assert.match(w!, /H\.264/, "a warning without the remedy is not much use");
});
check("H.264 / AV1 / VP9 produce no warning", () => {
  for (const c of ["h264", "av1", "vp9"] as const) assert.equal(uploadCodecWarning(c), null);
});
check("the warning fires even on a Mac that CAN play the file", () => {
  // The whole point is the OTHER machine. A local capability check would
  // wrongly stay silent for the exact person most likely to upload HEVC.
  const src = read("src/lib/video-codec.ts");
  assert.doesNotMatch(src, /canPlayHevcHere\(\)[\s\S]{0,80}uploadCodecWarning/,
    "upload warning must not be gated on local playback support");
  assert.equal(typeof canPlayHevcHere(), "object"); // null with no DOM
});
check("playback failure explains HEVC when that is the cause", () => {
  assert.match(playbackFailureMessage("hevc"), /H\.265|HEVC/);
  assert.match(playbackFailureMessage(null), /could not be played/);
});

console.log("a failure reaches the operator but NEVER the audience screen:");
check("the projector still hides the broken media", () => {
  const layer = read("src/components/live/SlideObjectsLayer.tsx");
  assert.match(layer, /visibility = "hidden"/, "an error must not be painted on the audience screen");
  assert.match(layer, /reportMediaFailure/, "...but it must no longer be silent");
});
check("only operator surfaces listen — outputs have no listener", () => {
  assert.match(read("src/components/operator/pro/ProOperatorShell.tsx"), /MEDIA_FAILURE_EVENT/);
  for (const page of ["src/app/live/page.tsx", "src/app/stage/page.tsx", "src/app/livestream/page.tsx"]) {
    assert.doesNotMatch(read(page), /MEDIA_FAILURE_EVENT/, `${page} must not surface media errors to the audience`);
  }
});
check("the same broken asset is reported once, not on every re-render", () => {
  resetMediaFailureLog();
  let n = 0;
  const g = globalThis as unknown as { window?: unknown };
  const listeners: Array<(e: Event) => void> = [];
  g.window = {
    dispatchEvent: (e: Event) => { if (e.type === MEDIA_FAILURE_EVENT) n++; listeners.forEach((l) => l(e)); return true; },
    addEventListener: () => {}, removeEventListener: () => {},
  };
  (globalThis as unknown as { CustomEvent: unknown }).CustomEvent = class { type: string; detail: unknown; constructor(t: string, o?: { detail?: unknown }) { this.type = t; this.detail = o?.detail; } };
  for (let i = 0; i < 5; i++) reportMediaFailure("https://x/broken.mov", "video");
  assert.equal(n, 1, "a looping video would otherwise spam the operator mid-service");
  delete g.window;
});
check("a missing url is a no-op", () => {
  resetMediaFailureLog();
  assert.doesNotThrow(() => reportMediaFailure(undefined, "video"));
});

console.log("the probe is bounded:");
check("we read a header, not the whole file", () => {
  assert.equal(CODEC_PROBE_BYTES, 64 * 1024);
  assert.match(read("src/components/operator/pro/center/MediaImportWizard.tsx"), /file\.slice\(0, CODEC_PROBE_BYTES\)/,
    "a 5GB video must not be read into memory to check its codec");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
