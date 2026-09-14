// cleanRenderUrl — write/read validator for stored media URLs (2026-09-14 pass).
// Run: npx tsx test/render-url-clean.test.ts
import assert from "node:assert/strict";
import { cleanRenderUrl } from "../src/lib/render-url";

const allow = [
  "/api/media/abc-123/file.png",
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
  "  /api/media/trim.png  ",
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
assert.equal(cleanRenderUrl("  /api/media/trim.png  "), "/api/media/trim.png");
console.log(`${allow.length + reject.length - fail} passed, ${fail} failed`);
assert.equal(fail, 0);
