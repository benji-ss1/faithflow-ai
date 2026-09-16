/**
 * Adversarial — media upload registration can't be pointed at another church's
 * storage, can't smuggle a disallowed type, and stored bytes must match the
 * claimed MIME. Pure validators + a mocked S3 probe, so it runs offline.
 *
 * Run: npx tsx test/adversarial/media-register-scope.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  validateMediaRegistration, isChurchUploadKey, verifyUploadedObject, sniffMediaMime, magicMatchesMime, checkStoredBytes,
  validateMultipartCreate, validateCompletedParts, validatePartNumbers, isPlausibleUploadId, buildUploadKey,
  MEDIA_MULTIPART_MAX_BYTES, MAX_BYTES, allowedMimesForPurpose, type ObjectProbe,
} from "../../src/lib/media-types";

let passed = 0, failed = 0;
const tests: Array<[string, () => void | Promise<void>]> = [];
const t = (label: string, fn: () => void | Promise<void>) => tests.push([label, fn]);

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const U = "33333333-3333-4333-8333-333333333333";
const key = (church: string, purpose = "media", ext = "jpg") => `${church}/${purpose}/${U}.${ext}`;
const reg = (o: Partial<{ kind: string; s3Key: string; mimeType: string }>) =>
  validateMediaRegistration({ kind: "image", s3Key: key(A), mimeType: "image/jpeg", sizeBytes: 10, fileName: "a.jpg", ...o }, A);

t("valid own-church registration passes", () => { assert.equal(reg({}).ok, true); });
t("cross-church key rejected", () => { assert.equal(reg({ s3Key: key(B) }).ok, false); });
t("church-id prefix trick rejected (A as prefix of longer id)", () => { assert.equal(reg({ s3Key: `${A}x/media/${U}.jpg` }).ok, false); });
t("path traversal rejected", () => {
  assert.equal(reg({ s3Key: `${A}/media/../${B}/media/${U}.jpg` }).ok, false);
  assert.equal(reg({ s3Key: `${A}/../${B}/media/${U}.jpg` }).ok, false);
});
t("wrong purpose (logo / pptx key) rejected for media", () => {
  assert.equal(reg({ s3Key: key(A, "logo") }).ok, false);
  assert.equal(reg({ s3Key: key(A, "pptx", "pptx") }).ok, false);
});
t("thumbnail / non-uuid keys rejected", () => {
  assert.equal(reg({ s3Key: `${key(A)}.thumb.jpg` }).ok, false);
  assert.equal(reg({ s3Key: `${A}/media/evil.jpg` }).ok, false);
});
t("bad mime rejected (svg, html, octet-stream, non-string)", () => {
  for (const m of ["image/svg+xml", "text/html", "application/octet-stream", "image/heic"]) assert.equal(reg({ mimeType: m }).ok, false, m);
  assert.equal(validateMediaRegistration({ kind: "image", s3Key: key(A), mimeType: 5, sizeBytes: 1, fileName: "x" }, A).ok, false);
});
t("kind must match mime", () => {
  assert.equal(reg({ kind: "video" }).ok, false);
  assert.equal(reg({ kind: "video", mimeType: "video/mp4", s3Key: key(A, "media", "mp4") }).ok, true);
  assert.equal(reg({ kind: "image", mimeType: "video/mp4", s3Key: key(A, "media", "mp4") }).ok, false);
  assert.equal(reg({ kind: "audio", mimeType: "audio/mpeg", s3Key: key(A, "media", "mp3") }).ok, true);
});
t("key extension must match claimed mime", () => {
  assert.equal(reg({ mimeType: "image/png" }).ok, false); // key is .jpg
});
t("pptx key scoping", () => {
  assert.equal(isChurchUploadKey(key(A, "pptx", "pptx"), A, "pptx"), true);
  assert.equal(isChurchUploadKey(key(B, "pptx", "pptx"), A, "pptx"), false);
  assert.equal(isChurchUploadKey(undefined, A, "pptx"), false);
  assert.equal(isChurchUploadKey(key(A, "pptx", "pptx"), "", "pptx"), false);
});
t("buildUploadKey round-trips through the scope check", () => {
  assert.equal(isChurchUploadKey(buildUploadKey(A, "media", U, "video/quicktime"), A, "media"), true);
});
t("presign allowlists: logo images only, pptx only pptx, svg nowhere", () => {
  assert.ok(!allowedMimesForPurpose("logo").includes("video/mp4"));
  assert.deepEqual([...allowedMimesForPurpose("pptx")].every((m) => m.includes("powerpoint") || m.includes("presentation")), true);
  for (const p of ["logo", "media", "pptx"] as const) assert.ok(!allowedMimesForPurpose(p).includes("image/svg+xml"));
});

// ── magic bytes ──
const bytes = (...xs: (number | string)[]) => {
  const out: number[] = [];
  for (const x of xs) typeof x === "string" ? out.push(...Array.from(x).map((c) => c.charCodeAt(0))) : out.push(x);
  while (out.length < 16) out.push(0);
  return new Uint8Array(out);
};
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0);
const PNG = bytes(0x89, "PNG", 0x0d, 0x0a);
const MP4 = bytes(0, 0, 0, 0x20, "ftypisom");
const MOV = bytes(0, 0, 0, 0x14, "ftypqt  ");
const WEBM = bytes(0x1a, 0x45, 0xdf, 0xa3);
const MP3 = bytes("ID3", 3);
const WAV = bytes("RIFF", 0, 0, 0, 0, "WAVE");
const M4A = bytes(0, 0, 0, 0x20, "ftypM4A ");
const AAC = bytes(0xff, 0xf1, 0x50);
const HTML = bytes("<html><script>");

t("sniffs the supported families", () => {
  assert.equal(sniffMediaMime(JPEG), "image/jpeg");
  assert.equal(sniffMediaMime(PNG), "image/png");
  assert.equal(sniffMediaMime(bytes("GIF89a")), "image/gif");
  assert.equal(sniffMediaMime(bytes("RIFF", 0, 0, 0, 0, "WEBP")), "image/webp");
  assert.equal(sniffMediaMime(bytes(0, 0, 0, 0x1c, "ftypavif")), "image/avif");
  assert.equal(sniffMediaMime(MP4), "video/mp4");
  assert.equal(sniffMediaMime(MOV), "video/quicktime");
  assert.equal(sniffMediaMime(WEBM), "video/webm");
  assert.equal(sniffMediaMime(MP3), "audio/mpeg");
  assert.equal(sniffMediaMime(WAV), "audio/wav");
  assert.equal(sniffMediaMime(M4A), "audio/mp4");
  assert.equal(sniffMediaMime(AAC), "audio/aac");
  assert.equal(sniffMediaMime(bytes(0, 0, 0, 0x18, "ftypheic")), "image/heic");
  assert.equal(sniffMediaMime(HTML), null);
});
t("mismatch detection (html as jpeg rejected, same-kind renames tolerated)", () => {
  assert.equal(magicMatchesMime(HTML, "image/jpeg"), false);
  assert.equal(magicMatchesMime(MOV, "video/mp4"), true);
  assert.equal(magicMatchesMime(MP4, "video/quicktime"), true);
  assert.equal(magicMatchesMime(MP4, "image/jpeg"), false);
});

t("sniff-compat: same-kind renames accepted and the SNIFFED mime is recorded", () => {
  assert.deepEqual(checkStoredBytes(PNG, "image/jpeg"), { ok: true, mimeType: "image/png" }); // png saved as .jpg
  assert.deepEqual(checkStoredBytes(JPEG, "image/png"), { ok: true, mimeType: "image/jpeg" });
  assert.deepEqual(checkStoredBytes(M4A, "audio/aac"), { ok: true, mimeType: "audio/mp4" }); // .m4a named .aac
  // Markup hidden behind a media-looking prefix is refused; a normal ID3 mp3 still passes.
  const id3Html = new Uint8Array([...Buffer.from("ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000"), ...Buffer.from("<html><script>alert(1)</script>")]);
  assert.deepEqual(checkStoredBytes(id3Html, "audio/mpeg"), { ok: false });
  const id3Mp3 = new Uint8Array([...Buffer.from("ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000"), 0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0]);
  assert.equal(checkStoredBytes(id3Mp3, "audio/mpeg").ok, true);
  assert.equal(checkStoredBytes(WEBM, "video/mp4").ok, true); // webm↔mp4
  assert.equal(checkStoredBytes(MP4, "video/webm").ok, true);
  assert.deepEqual(checkStoredBytes(MP4, "audio/mp4"), { ok: true, mimeType: "audio/mp4" }); // m4a with mp4 brand
});
t("sniff-compat: AVIF with mif1/msf1 major brand (avif in compatible brands) accepted", () => {
  const avifMif1 = bytes(0, 0, 0, 0x1c, "ftypmif1", 0, 0, 0, 0, "mif1avifmiaf");
  assert.equal(sniffMediaMime(avifMif1), "image/avif");
  assert.equal(checkStoredBytes(avifMif1, "image/avif").ok, true);
  const heicMif1 = bytes(0, 0, 0, 0x18, "ftypmif1", 0, 0, 0, 0, "mif1heic");
  assert.equal(checkStoredBytes(heicMif1, "image/avif").ok, false); // unconverted HEIC stays out
});
t("sniff-compat: MP4 without leading ftyp, MP3 with APE tag / zero padding, RF64/BW64 WAV", () => {
  assert.equal(checkStoredBytes(bytes(0, 0, 0, 8, "free", 0, 0, 0, 8, "mdat"), "video/mp4").ok, true);
  assert.equal(checkStoredBytes(bytes("APETAGEX"), "audio/mpeg").ok, true);
  const padded = new Uint8Array(64); padded[20] = 0xff; padded[21] = 0xfb; padded[22] = 0x90;
  assert.equal(checkStoredBytes(padded, "audio/mpeg").ok, true);
  assert.equal(checkStoredBytes(bytes("RF64", 0, 0, 0, 0, "WAVE"), "audio/wav").ok, true);
  assert.equal(checkStoredBytes(bytes("BW64", 0, 0, 0, 0, "WAVE"), "audio/wav").ok, true);
});
t("sniff-compat: cross-kind, dangerous and unknown-image bytes rejected", () => {
  assert.equal(checkStoredBytes(HTML, "image/png").ok, false); // html-in-png
  assert.equal(checkStoredBytes(bytes("  <svg onload=x>"), "image/png").ok, false);
  assert.equal(checkStoredBytes(bytes("<!doctype html>"), "video/mp4").ok, false);
  assert.equal(checkStoredBytes(bytes("%PDF-1.7"), "audio/mpeg").ok, false);
  assert.equal(checkStoredBytes(bytes("PK", 3, 4), "video/mp4").ok, false);
  assert.equal(checkStoredBytes(bytes("#!/bin/sh"), "audio/wav").ok, false);
  assert.equal(checkStoredBytes(MP4, "image/jpeg").ok, false); // video bytes as image
  assert.equal(checkStoredBytes(JPEG, "video/mp4").ok, false); // image bytes as video
  assert.equal(checkStoredBytes(bytes(1, 2, 3, 4, 5), "image/png").ok, false); // unknown image
  assert.equal(checkStoredBytes(bytes(1, 2, 3, 4, 5), "video/mp4").ok, true); // unknown video tolerated
});

function probe(o: { size?: number | null; head?: Uint8Array | null }) {
  const removed: string[] = [];
  const p: ObjectProbe = {
    head: async () => (o.size == null ? null : { size: o.size }),
    readHead: async () => o.head ?? null,
    remove: async (k) => { removed.push(k); },
  };
  return { p, removed };
}
t("verify: good object passes and reports REAL size", async () => {
  const { p, removed } = probe({ size: 1234, head: JPEG });
  assert.deepEqual(await verifyUploadedObject(key(A), "image/jpeg", "image", p), { ok: true, sizeBytes: 1234, mimeType: "image/jpeg" });
  assert.equal(removed.length, 0);
});
t("verify: missing object → error, nothing deleted", async () => {
  const { p, removed } = probe({ size: null });
  assert.equal((await verifyUploadedObject(key(A), "image/jpeg", "image", p)).ok, false);
  assert.equal(removed.length, 0);
});
t("verify: magic mismatch deletes the object", async () => {
  const { p, removed } = probe({ size: 50, head: HTML });
  assert.equal((await verifyUploadedObject(key(A), "image/jpeg", "image", p)).ok, false);
  assert.deepEqual(removed, [key(A)]);
});
t("verify: oversize image (>500MB) deleted; 2GB video allowed; >5GB video deleted", async () => {
  let r = probe({ size: MAX_BYTES.media + 1, head: JPEG });
  assert.equal((await verifyUploadedObject(key(A), "image/jpeg", "image", r.p)).ok, false);
  assert.equal(r.removed.length, 1);
  r = probe({ size: 2 * 1024 ** 3, head: MP4 });
  assert.equal((await verifyUploadedObject(key(A, "media", "mp4"), "video/mp4", "video", r.p)).ok, true);
  r = probe({ size: MEDIA_MULTIPART_MAX_BYTES + 1, head: MP4 });
  assert.equal((await verifyUploadedObject(key(A, "media", "mp4"), "video/mp4", "video", r.p)).ok, false);
  assert.equal(r.removed.length, 1);
});
t("verify: empty object deleted", async () => {
  const { p, removed } = probe({ size: 0, head: JPEG });
  assert.equal((await verifyUploadedObject(key(A), "image/jpeg", "image", p)).ok, false);
  assert.equal(removed.length, 1);
});

t("verify: transient HEAD error keeps the object (retryable)", async () => {
  const removed: string[] = [];
  const r = await verifyUploadedObject(key(A), "image/jpeg", "image", {
    head: async () => { throw new Error("ECONNRESET"); }, readHead: async () => JPEG, remove: async (k) => { removed.push(k); },
  });
  assert.equal(r.ok, false); assert.equal(!r.ok && r.retryable, true); assert.equal(removed.length, 0);
});
t("verify: transient read error (throw or null) keeps a good object", async () => {
  for (const readHead of [async () => { throw new Error("503"); }, async () => null]) {
    const removed: string[] = [];
    const r = await verifyUploadedObject(key(A), "image/jpeg", "image", {
      head: async () => ({ size: 99 }), readHead, remove: async (k) => { removed.push(k); },
    });
    assert.equal(r.ok, false); assert.equal(!r.ok && r.retryable, true); assert.equal(removed.length, 0);
  }
});
t("verify: a referenced object is never deleted, even on mismatch", async () => {
  const removed: string[] = [];
  const r = await verifyUploadedObject(key(A), "image/jpeg", "image", {
    head: async () => ({ size: 50 }), readHead: async () => HTML, remove: async (k) => { removed.push(k); }, isReferenced: async () => true,
  });
  assert.equal(r.ok, false); assert.equal(removed.length, 0);
});
t("verify: png bytes under a .jpg claim pass and report image/png", async () => {
  const { p } = probe({ size: 10, head: PNG });
  assert.deepEqual(await verifyUploadedObject(key(A), "image/jpeg", "image", p), { ok: true, sizeBytes: 10, mimeType: "image/png" });
});

// ── multipart validators ──
t("multipart create: videos only, capped", () => {
  assert.equal(validateMultipartCreate({ contentType: "video/mp4", size: 600 * 1024 ** 2 }).ok, true);
  assert.equal(validateMultipartCreate({ contentType: "image/jpeg", size: 600 * 1024 ** 2 }).ok, false);
  assert.equal(validateMultipartCreate({ contentType: "video/mp4", size: MEDIA_MULTIPART_MAX_BYTES + 1 }).ok, false);
  assert.equal(validateMultipartCreate({ contentType: "video/mp4", size: 0 }).ok, false);
  assert.equal(validateMultipartCreate({ contentType: "video/mp4", size: "9" }).ok, false);
});
t("multipart parts/complete/uploadId validators reject junk", () => {
  assert.deepEqual(validatePartNumbers([1, 2]), [1, 2]);
  assert.equal(validatePartNumbers([0]), null);
  assert.equal(validatePartNumbers([1.5]), null);
  assert.equal(validatePartNumbers(Array.from({ length: 101 }, (_, i) => i + 1)), null);
  assert.ok(validateCompletedParts([{ partNumber: 1, etag: '"abc"' }, { partNumber: 2, etag: "def" }]));
  assert.equal(validateCompletedParts([{ partNumber: 2, etag: "a" }, { partNumber: 1, etag: "b" }]), null);
  assert.equal(validateCompletedParts([{ partNumber: 1, etag: "<xml/>" }]), null);
  assert.equal(isPlausibleUploadId("abc.DEF_123-~"), true);
  assert.equal(isPlausibleUploadId("a b"), false);
  assert.equal(isPlausibleUploadId(""), false);
});

// ── source invariants: every server path that takes a client key checks the church scope ──
const src = (p: string) => fs.readFileSync(path.resolve(__dirname, "../..", p), "utf8");
t("registerMediaAsset validates + verifies before insert", () => {
  const a = src("src/lib/actions.ts");
  const body = a.slice(a.indexOf("export async function registerMediaAsset"), a.indexOf("export async function deleteMediaAsset"));
  const iv = body.indexOf("validateMediaRegistration(");
  const iverify = body.indexOf("verifyUploadedObject(");
  const iins = body.indexOf("db.insert(mediaAssets)");
  assert.ok(iv > 0 && iverify > iv && iins > iverify, "validate → verify → insert order");
  assert.ok(body.includes("isAudioMediaSupported"), "audio gated");
});
t("createPptxImport checks the church pptx key", () => {
  const a = src("src/lib/actions.ts");
  const body = a.slice(a.indexOf("export async function createPptxImport"), a.indexOf("export async function deletePptxImport"));
  assert.ok(body.indexOf("isChurchUploadKey(s3Key, user.churchId, \"pptx\")") < body.indexOf("db.insert"));
});
t("to-pdf route + pptx converter + thumbnail backfill check the church prefix", () => {
  assert.ok(src("src/app/api/pptx/to-pdf/route.ts").includes("isChurchUploadKey(key, user.churchId, \"pptx\")"));
  assert.ok(src("src/lib/pptx.ts").includes("imp.sourceS3Key.startsWith(`${imp.churchId}/`)"));
  assert.ok(src("src/app/api/media/backfill-thumbnails/route.ts").includes("m.s3Key.startsWith(`${user.churchId}/`)"));
});
t("multipart routes are auth-gated and church-key scoped", () => {
  const shared = src("src/app/api/media/multipart/_shared.ts");
  assert.ok(shared.includes("apiUser()") && shared.includes("isChurchUploadKey(key, churchId, \"media\")"));
  for (const r of ["create", "parts", "complete", "abort"]) {
    const s = src(`src/app/api/media/multipart/${r}/route.ts`);
    assert.ok(s.includes("multipartAuth(limiter)"), `${r} uses multipartAuth`);
    assert.ok(s.includes("createLimiter("), `${r} rate-limited`);
    if (r !== "create") assert.ok(s.includes("parseKeyAndUpload(body, user.churchId)"), `${r} scopes key`);
    else assert.ok(s.includes("buildUploadKey(user.churchId"), "create builds key server-side");
  }
});

(async () => {
  for (const [label, fn] of tests) {
    try { await fn(); passed++; console.log(`  ok  ${label}`); }
    catch (e) { failed++; console.error(`  FAIL  ${label}: ${e instanceof Error ? e.message : e}`); }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
