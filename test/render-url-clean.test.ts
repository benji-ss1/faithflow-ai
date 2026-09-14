// cleanRenderUrl — write/read validator for stored media URLs (2026-09-14 pass).
// Run: npx tsx test/render-url-clean.test.ts
import assert from "node:assert/strict";
import { cleanRenderUrl } from "../src/lib/render-url";

const allow = [
  "/api/media/95f5dd86-dc58-4674-9bd1-ca8af7d8abbc/file.png",
  "/marketing/how-show.jpg",
  "https://bucket.s3.amazonaws.com/church/x.png?X-Amz-Signature=abc&X-Amz-Expires=3600",
  "https://abcd.supabase.co/storage/v1/object/sign/media/x.jpg?token=eyJ.abc",
  "http://localhost:9000/faithflow-media/logo.png",
  "blob:http://localhost:3000/4b1c-uuid",
  "data:image/png;base64,iVBORw0KGgo=",
  "data:image/jpeg;base64,/9j/4AAQ",
  "data:image/jpg;base64,/9j/4AAQ",
  "data:image/webp;base64,UklGR",
  "data:image/gif;base64,R0lGOD",
  "  /api/media/95f5dd86-dc58-4674-9bd1-ca8af7d8abbc  ",
  "/api/media/95f5dd86-dc58-4674-9bd1-ca8af7d8abbc",
  "http://127.0.0.1:9000/x.png",
];
const reject = [
  "",
  "//evil.com/x.png",
  "/\\evil.com/x.png",
  "https://x.com/a\\b.png",
  'https://x.com/a".png',
  "https://x.com/a'.png",
  "https://x.com/a b.png",
  "https://x.com/<script>.png",
  "data:image/svg+xml;base64,PHN2Zz4=",
  "data:text/html,<b>x</b>",
  "data:image/png",
  "javascript:alert(1)",
  "file:///etc/passwd",
  "ftp://x.com/a.png",
  "http://evil.com/x.png",           // http only for loopback (and never in prod)
  "http://localhost.evil.com/x.png",
  "blob",
  "/api/media/a\u0000b",
  "https:evil.com",
  "x".repeat(2049),
  42,
  null,
];
let fail = 0;
for (const u of allow) {
  if (cleanRenderUrl(u) === null) { fail++; console.error("FAIL should allow:", u); }
}
for (const u of reject) {
  if (cleanRenderUrl(u) !== null) { fail++; console.error("FAIL should reject:", String(u).slice(0, 80)); }
}
assert.equal(cleanRenderUrl("  /api/media/95f5dd86-dc58-4674-9bd1-ca8af7d8abbc  "), "/api/media/95f5dd86-dc58-4674-9bd1-ca8af7d8abbc");
// ONE URL POLICY: the output-side validators agree with save/read.
import("../src/lib/broadcast").then(({ isValidRenderUrl, sanitizeSlide }) => {
  for (const u of allow.map((x) => x.trim()).filter((x) => !x.startsWith("blob:"))) assert.equal(isValidRenderUrl(u), true, `output should accept ${u}`);
  // blob: is the one deliberate output narrowing (tab-local preview): rejected for
  // objects/backgrounds, still accepted on media slides as before.
  assert.equal(isValidRenderUrl("blob:http://localhost:3000/4b1c-uuid"), false);
  assert.notEqual(sanitizeSlide({ kind: "image", url: "blob:http://localhost:3000/4b1c-uuid" }), null);
  for (const u of reject) assert.equal(isValidRenderUrl(u), false, `output should reject ${String(u).slice(0, 60)}`);
  assert.equal(isValidRenderUrl("  /api/media/x.png"), false, "wire values are not trimmed");
  // media slides no longer accept arbitrary http hosts / raw quotes; DO accept same-origin relative.
  assert.notEqual(sanitizeSlide({ kind: "image", url: "/api/media/95f5dd86-dc58-4674-9bd1-ca8af7d8abbc" }), null);
  assert.equal(sanitizeSlide({ kind: "image", url: "http://evil.com/x.png" }), null);
  assert.equal(sanitizeSlide({ kind: "image", url: 'https://x.com/a".png' }), null);
  const long = sanitizeSlide({ kind: "image", url: "/api/media/95f5dd86-dc58-4674-9bd1-ca8af7d8abbc", layout: "third", bandMode: "caption", caption: "c".repeat(900) }) as { caption?: string } | null;
  assert.equal(long?.caption?.length, 500, "over-long caption truncated, not dropped");
  console.log("output-side policy parity OK");
});
console.log(`${allow.length + reject.length - fail} passed, ${fail} failed`);
assert.equal(fail, 0);
