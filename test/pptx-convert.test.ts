/**
 * PowerPoint import: converter signature/error mapping, route response handling
 * (new JSON vs old PDF-bytes converter), retry policy, temp-key scoping, and the
 * wizard's progress labels + auto-start rule. Pure — no I/O.
 * Run: npx tsx test/pptx-convert.test.ts
 */
import assert from "node:assert/strict";
import {
  sniffDeckSignature, mapSofficeFailure, statusForCode, isAllowedUrl, CONVERT_MESSAGES,
} from "../scripts/convert-lib";
import {
  responseKind, isRetryableStatus, retryDelayMs, canRetry, operatorConvertError, isChurchPptxTempKey,
  deckStageLabel, isDeckOnlyQueue, GENERIC_CONVERT_ERROR, PPTX_MAX_BYTES,
} from "../src/lib/pptx-import";
import { MAX_BYTES } from "../src/lib/media-types";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}
const bytes = (...parts: Array<number[] | string>) => {
  const out: number[] = [];
  for (const p of parts) typeof p === "string" ? out.push(...Array.from(Buffer.from(p, "latin1"))) : out.push(...p);
  return new Uint8Array(out);
};
const utf16 = (s: string) => Array.from(Buffer.from(s, "utf16le"));
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const PK = [0x50, 0x4b, 0x03, 0x04];

// ── signature ────────────────────────────────────────────────────────────────
check("pptx zip with ppt/ entries in head → pptx", () => {
  assert.equal(sniffDeckSignature(bytes(PK, "....[Content_Types].xml....ppt/presentation.xml")), "pptx");
});
check("pptx zip with ppt/ only in central directory (tail) → pptx", () => {
  assert.equal(sniffDeckSignature(bytes(PK, "....[Content_Types].xml"), bytes("PK\x01\x02..ppt/slides/slide1.xml")), "pptx");
});
check("docx/xlsx zip (no ppt/) → rejected", () => {
  assert.equal(sniffDeckSignature(bytes(PK, "word/document.xml"), bytes("word/styles.xml")), null);
});
check("legacy OLE .ppt → ppt", () => {
  assert.equal(sniffDeckSignature(bytes(OLE, "....", utf16("PowerPoint Document"))), "ppt");
});
check("password-protected pptx (OLE + EncryptedPackage) → encrypted", () => {
  assert.equal(sniffDeckSignature(bytes(OLE, "..", utf16("EncryptionInfo"), "..", utf16("EncryptedPackage"))), "encrypted");
});
check("random bytes / PDF / JPEG / empty → rejected", () => {
  assert.equal(sniffDeckSignature(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])), null);
  assert.equal(sniffDeckSignature(bytes("%PDF-1.7")), null);
  assert.equal(sniffDeckSignature(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), null);
  assert.equal(sniffDeckSignature(new Uint8Array()), null);
});

// ── soffice error mapping ─────────────────────────────────────────────────────
check("soffice load failure → corrupt", () => {
  assert.equal(mapSofficeFailure("Error: source file could not be loaded", false), "corrupt");
});
check("password text → password", () => {
  assert.equal(mapSofficeFailure("Error: document is password protected", false), "password");
});
check("no export filter → unsupported", () => {
  assert.equal(mapSofficeFailure("Error: no export filter for /tmp/x.pdf found", false), "unsupported");
});
check("silent failure without output → corrupt; with output → failed", () => {
  assert.equal(mapSofficeFailure("", false), "corrupt");
  assert.equal(mapSofficeFailure("", true), "failed");
});
check("status codes", () => {
  assert.equal(statusForCode("busy"), 429);
  assert.equal(statusForCode("not_presentation"), 415);
  assert.equal(statusForCode("timeout"), 504);
  assert.equal(statusForCode("password"), 422);
});
check("messages are plain and match the spec wording", () => {
  assert.equal(CONVERT_MESSAGES.not_presentation, "This doesn't look like a PowerPoint file.");
  assert.match(CONVERT_MESSAGES.timeout, /^This presentation took too long to convert/);
  for (const m of Object.values(CONVERT_MESSAGES)) assert.doesNotMatch(m, /soffice|stderr|errno|ENOENT|\/tmp/i);
});
check("URL policy: https only unless dev http allowed; host allowlist", () => {
  assert.equal(isAllowedUrl("https://s3.example.com/a", false), true);
  assert.equal(isAllowedUrl("http://localhost:9000/a", false), false);
  assert.equal(isAllowedUrl("http://localhost:9000/a", true), true);
  assert.equal(isAllowedUrl("file:///etc/passwd", true), false);
  assert.equal(isAllowedUrl("https://evil.example/a", false, ["s3.example.com"]), false);
  assert.equal(isAllowedUrl(123, true), false);
});

// ── route: response shape + retry ─────────────────────────────────────────────
check("old converter (application/pdf) vs new converter (JSON)", () => {
  assert.equal(responseKind("application/pdf"), "pdf");
  assert.equal(responseKind("application/pdf; charset=binary"), "pdf");
  assert.equal(responseKind("application/json"), "json");
  assert.equal(responseKind(null), "json");
});
check("retry on busy / cold-start statuses only", () => {
  for (const s of [429, 502, 503]) assert.equal(isRetryableStatus(s), true);
  for (const s of [200, 400, 401, 415, 422, 500, 504]) assert.equal(isRetryableStatus(s), false);
  assert.deepEqual([0, 1, 2, 3, 6].map(retryDelayMs), [2000, 4000, 8000, 15000, 15000]);
});
check("retries stop at max and when the budget is nearly spent", () => {
  assert.equal(canRetry(0, 3, 0), true);
  assert.equal(canRetry(3, 3, 0), false);
  assert.equal(canRetry(5, 12, 120_000), true, "keeps retrying a busy converter while budget remains");
  assert.equal(canRetry(0, 3, 250_000), false);
});
check("operator errors: known codes pass through, raw strings never do", () => {
  assert.equal(operatorConvertError(422, { code: "password", error: "x" }), CONVERT_MESSAGES.password);
  assert.equal(operatorConvertError(500, { error: "source fetch failed (403) /tmp/foo soffice" }), GENERIC_CONVERT_ERROR);
  assert.equal(operatorConvertError(500, { code: "made_up", error: "raw" }), GENERIC_CONVERT_ERROR);
  assert.match(operatorConvertError(429, { code: "busy" }), /busy/);
  assert.equal(operatorConvertError(504, null), CONVERT_MESSAGES.timeout);
});
check("temp-key scoping for cleanup DELETE", () => {
  const c = "11111111-2222-3333-4444-555555555555";
  const u = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  assert.equal(isChurchPptxTempKey(`${c}/pptx/${u}.pdf`, c), true);
  assert.equal(isChurchPptxTempKey(`${c}/pptx/${u}.pptx`, c), true);
  assert.equal(isChurchPptxTempKey(`${c}/media/${u}.jpg`, c), false, "never media");
  assert.equal(isChurchPptxTempKey(`other/pptx/${u}.pdf`, c), false, "never another church");
  assert.equal(isChurchPptxTempKey(`${c}/pptx/${u}/slide-001.png`, c), false, "never library import slides");
  assert.equal(isChurchPptxTempKey(`${c}/pptx/../media/${u}.pdf`, c), false);
  assert.equal(isChurchPptxTempKey(undefined, c), false);
});
check("client cap mirrors the server pptx cap", () => {
  assert.equal(PPTX_MAX_BYTES, MAX_BYTES.pptx);
});

// ── wizard: progress + auto-start ────────────────────────────────────────────
check("progress labels", () => {
  assert.equal(deckStageLabel({ kind: "upload-source", fraction: 0.42 }), "Uploading deck 42%");
  assert.equal(deckStageLabel({ kind: "upload-source", fraction: 1.4 }), "Uploading deck 100%");
  assert.equal(deckStageLabel({ kind: "convert", elapsedSec: 5.7 }), "Converting… 5s");
  assert.equal(deckStageLabel({ kind: "convert", elapsedSec: 35 }), "Converting… 35s (big decks can take a minute)");
  assert.equal(deckStageLabel({ kind: "prepare", index: 12, total: 60 }), "Preparing slide 12/60");
  assert.equal(deckStageLabel({ kind: "upload-slides", done: 12, total: 60 }), "Uploading slide 12/60");
});
check("auto-start only when every queued file is a deck", () => {
  assert.equal(isDeckOnlyQueue([{ tag: "media", deck: true }, { tag: "media", deck: true }]), true);
  assert.equal(isDeckOnlyQueue([{ tag: "media", deck: true }, { tag: "media" }]), false);
  assert.equal(isDeckOnlyQueue([{ tag: "pro" }]), false);
  assert.equal(isDeckOnlyQueue([]), false);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
