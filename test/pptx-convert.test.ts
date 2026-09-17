/**
 * PowerPoint import: converter signature/error mapping, route response handling
 * (new JSON vs old PDF-bytes converter), retry policy, temp-key scoping, and the
 * wizard's progress labels + auto-start rule. Pure — no I/O.
 * Run: npx tsx test/pptx-convert.test.ts
 */
import assert from "node:assert/strict";
import {
  sniffDeckSignature, mapSofficeFailure, statusForCode, isAllowedUrl, CONVERT_MESSAGES,
  classifyIp, isIpAllowed, findZipEocd, checkZipCentralDirectory, ZIP_MAX_ENTRIES,
} from "../scripts/convert-lib";
import { secretMatches } from "../scripts/convert-auth";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  responseKind, isRetryableStatus, isRetryableConverterReply, pptxDeleteKind, retryDelayMs, canRetry, operatorConvertError, isChurchPptxTempKey,
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
check("OLE .doc / .xls (Word/Excel streams, no PowerPoint stream) → rejected", () => {
  assert.equal(sniffDeckSignature(bytes(OLE, "....", utf16("WordDocument"))), null);
  assert.equal(sniffDeckSignature(bytes(OLE, "....", utf16("Workbook"))), null);
  assert.equal(sniffDeckSignature(bytes(OLE, "....", utf16("WordDocument"), utf16("PowerPoint Document"))), "ppt");
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
  // converter-coded replies: only "busy" retries
  assert.equal(isRetryableConverterReply(429, "busy"), true);
  assert.equal(isRetryableConverterReply(503, "busy"), true);
  for (const c of ["upload_failed", "source_unavailable", "password", "corrupt", "not_presentation", "too_large", "timeout", "bad_request"]) {
    assert.equal(isRetryableConverterReply(502, c), false, c);
    assert.equal(isRetryableConverterReply(429, c), false, c);
  }
  assert.equal(isRetryableConverterReply(502, undefined), true, "Fly proxy 502 without code");
  assert.equal(isRetryableConverterReply(504, undefined), false);
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
  assert.doesNotMatch(operatorConvertError(429, { code: "busy" }), /trying again/, "neutral: old route doesn't retry");
  assert.doesNotMatch(CONVERT_MESSAGES.busy, /trying again/);
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

// ── S1 SSRF IP classifier ─────────────────────────────────────────────────────
check("SSRF: private/loopback/link-local/CGNAT/ULA/6PN blocked; public allowed", () => {
  for (const ip of ["10.0.0.1", "172.16.5.4", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "100.127.255.254",
    "0.0.0.0", "fc00::1", "fd12:3456::1", "fdaa:0:1::3", "fe80::1", "::", "::ffff:10.0.0.1", "::ffff:169.254.169.254", "ff02::1"]) {
    assert.equal(classifyIp(ip), "blocked", ip);
    assert.equal(isIpAllowed(ip, true), false, `${ip} even with dev bypass`);
  }
  for (const ip of ["127.0.0.1", "127.8.9.1", "::1", "::ffff:127.0.0.1"]) {
    assert.equal(classifyIp(ip), "loopback", ip);
    assert.equal(isIpAllowed(ip, false), false, `${ip} prod`);
    assert.equal(isIpAllowed(ip, true), true, `${ip} dev`);
  }
  for (const ip of ["8.8.8.8", "172.32.0.1", "100.128.0.1", "52.95.110.1", "2606:4700::1111"]) {
    assert.equal(classifyIp(ip), "public", ip);
    assert.equal(isIpAllowed(ip, false), true, ip);
  }
  assert.equal(classifyIp("not-an-ip"), "invalid");
  assert.equal(isIpAllowed("not-an-ip", true), false);
});

// ── S2 timing-safe secret ─────────────────────────────────────────────────────
check("secret compare: match, mismatch, empty server secret, array header", () => {
  assert.equal(secretMatches("s3cret", "s3cret"), true);
  assert.equal(secretMatches("s3cret!", "s3cret"), false);
  assert.equal(secretMatches("", "s3cret"), false);
  assert.equal(secretMatches("anything", ""), false, "fail closed");
  assert.equal(secretMatches(["s3cret", "s3cret"], "s3cret"), false, "array header");
  assert.equal(secretMatches(undefined, "s3cret"), false);
});

// ── S3 zip bomb (central directory) ───────────────────────────────────────────
function makeZip(entries: Array<{ name: string; comp: number; uncomp: number }>, declared?: number): { file: Uint8Array } {
  const cdParts: Buffer[] = [];
  for (const e of entries) {
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0); h.writeUInt32LE(e.comp, 20); h.writeUInt32LE(e.uncomp, 24);
    h.writeUInt16LE(Buffer.byteLength(e.name), 28);
    cdParts.push(h, Buffer.from(e.name));
  }
  const cd = Buffer.concat(cdParts);
  const local = Buffer.from("PK\x03\x04 fake local data ppt/", "latin1");
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Math.min(declared ?? entries.length, 0xffff), 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(local.length, 16);
  return { file: new Uint8Array(Buffer.concat([local, cd, eocd])) };
}
function zipVerdict(file: Uint8Array) {
  const eocd = findZipEocd(file, file.length);
  assert.ok(eocd, "eocd found");
  return checkZipCentralDirectory(file.subarray(eocd!.cdOffset, eocd!.cdOffset + eocd!.cdSize), eocd!.entries);
}
check("zip: a normal deck passes", () => {
  const v = zipVerdict(makeZip([{ name: "ppt/presentation.xml", comp: 2000, uncomp: 9000 }, { name: "ppt/media/image1.jpeg", comp: 5_000_000, uncomp: 5_010_000 }]).file);
  assert.equal(v.ok, true);
});
check("zip: total uncompressed > 1.5 GB rejected", () => {
  const big = Array.from({ length: 4 }, (_, i) => ({ name: `ppt/media/x${i}.bin`, comp: 400_000_000, uncomp: 500_000_000 }));
  assert.equal(zipVerdict(makeZip(big).file).ok, false);
});
check("zip: absurd per-entry ratio rejected", () => {
  assert.equal(zipVerdict(makeZip([{ name: "ppt/slides/slide1.xml", comp: 20_000, uncomp: 200_000_000 }]).file).ok, false);
});
check("zip: entry count > 20k rejected", () => {
  assert.equal(checkZipCentralDirectory(new Uint8Array(), ZIP_MAX_ENTRIES + 1).ok, false);
});
check("zip: no EOCD → null", () => {
  assert.equal(findZipEocd(new Uint8Array(100), 100), null);
});

// ── S6 DELETE key rules ───────────────────────────────────────────────────────
check("DELETE: pdf always; pptx/ppt only when unreferenced", () => {
  const c = "11111111-2222-3333-4444-555555555555";
  const u = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  assert.equal(pptxDeleteKind(`${c}/pptx/${u}.pdf`), "pdf");
  assert.equal(pptxDeleteKind(`${c}/pptx/${u}.PDF`), "pdf");
  assert.equal(pptxDeleteKind(`${c}/pptx/${u}.pptx`), "source-if-unreferenced");
  assert.equal(pptxDeleteKind(`${c}/pptx/${u}.ppt`), "source-if-unreferenced");
});

// ── D1 deploy.sh never rotates an existing converter secret ──────────────────
function runDeploy(opts: { appExists: boolean; hasSecret: boolean; envSecret?: string }) {
  const home = mkdtempSync(join(tmpdir(), "deploy-test-"));
  mkdirSync(join(home, ".fly/bin"), { recursive: true });
  const log = join(home, "calls.log");
  writeFileSync(log, "");
  const fake = `#!/usr/bin/env bash
echo "$*" >> "${log}"
case "$1 $2" in
  "auth whoami") echo tester ;;
  "apps list") ${opts.appExists ? 'echo "faithflow-convert personal deployed"' : "true"} ;;
  "secrets list") echo "NAME DIGEST CREATED"; ${opts.hasSecret ? 'echo "CONVERT_SHARED_SECRET abc123 1d ago"' : "true"} ;;
esac
exit 0
`;
  writeFileSync(join(home, ".fly/bin/flyctl"), fake);
  chmodSync(join(home, ".fly/bin/flyctl"), 0o755);
  const env = { ...process.env, HOME: home, CONVERT_SHARED_SECRET: opts.envSecret ?? "" };
  let code = 0;
  try { execFileSync("bash", ["scripts/deploy.sh", "convert"], { env, stdio: "pipe" }); } catch (e) { code = (e as { status: number }).status ?? 1; }
  return { code, calls: readFileSync(log, "utf8") };
}
check("deploy.sh convert: existing secret is kept (never set)", () => {
  const r = runDeploy({ appExists: true, hasSecret: true });
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.calls, /secrets set/);
  assert.match(r.calls, /^deploy /m);
});
check("deploy.sh convert: first-time app creation mints + stages a secret", () => {
  const r = runDeploy({ appExists: false, hasSecret: false });
  assert.equal(r.code, 0);
  assert.match(r.calls, /apps create/);
  assert.match(r.calls, /secrets set CONVERT_SHARED_SECRET=[0-9a-f]{64} --stage/);
});
check("deploy.sh convert: existing app without secret and no env → refuses", () => {
  const r = runDeploy({ appExists: true, hasSecret: false });
  assert.notEqual(r.code, 0);
  assert.doesNotMatch(r.calls, /secrets set|^deploy /m);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
