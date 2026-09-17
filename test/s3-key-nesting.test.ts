/**
 * keyFromPresignedUrl must be idempotent on endpoints with a path (Supabase
 * /storage/v1/s3): re-signing never nests "storage/v1/s3/<bucket>/" and an
 * already-nested stored URL heals to the real key.
 * Run: npx tsx test/s3-key-nesting.test.ts
 */
import assert from "node:assert/strict";
process.env.AWS_ACCESS_KEY_ID = "x"; process.env.AWS_SECRET_ACCESS_KEY = "y";
process.env.S3_BUCKET = "Presentflow-media";
process.env.S3_ENDPOINT = "https://abc.supabase.co/storage/v1/s3";
let pass = 0, fail = 0;
const check = (n: string, fn: () => void) => { try { fn(); console.log(`  PASS  ${n}`); pass++; } catch (e) { console.error(`  FAIL  ${n}\n        ${(e as Error).message}`); fail++; } };
async function main() {
  const { keyFromPresignedUrl } = await import("../src/lib/s3");
  const P = "storage/v1/s3/Presentflow-media/";
  const url = (path: string) => `https://abc.supabase.co/${path}?X-Amz-Signature=abc`;
  const KEY = "c8851abe-f521-4e32-b028-e8685d043f0a/logo.png";
  check("path-style supabase URL → bare key", () => assert.equal(keyFromPresignedUrl(url(P + KEY)), KEY));
  check("5× nested (prod corruption) heals to bare key", () => assert.equal(keyFromPresignedUrl(url(P.repeat(5) + KEY)), KEY));
  check("idempotent: key → url → key stable", () => { const k = keyFromPresignedUrl(url(P + KEY))!; assert.equal(keyFromPresignedUrl(url(P + k)), KEY); });
  check("foreign host untouched", () => assert.equal(keyFromPresignedUrl(`https://evil.test/${P}${KEY}?X-Amz-Signature=a`), null));
  check("unsigned URL untouched", () => assert.equal(keyFromPresignedUrl(`https://abc.supabase.co/${P}${KEY}`), null));
  check("bucket-only path → null", () => assert.equal(keyFromPresignedUrl(url(P)), null));
  check("encoded-slash traversal to another church → null", () => assert.equal(keyFromPresignedUrl(url(P + "c8851abe-f521-4e32-b028-e8685d043f0a%2F..%2Fbbbb-church/x.png")), null));
  check("encoded single-dot segment → null", () => assert.equal(keyFromPresignedUrl(url(P + "aaaa%2F.%2Fx.png")), null));
  check("encoded backslash → null", () => assert.equal(keyFromPresignedUrl(url(P + "aaaa%5C..%5Cbbbb/x.png")), null));
  check("malformed percent-encoding → null, no throw", () => assert.equal(keyFromPresignedUrl(url(P + "aaaa/%E0%A4%A.png")), null));
  process.env.S3_ENDPOINT = "https://minio.test"; process.env.S3_BUCKET = "faithflow-media";
  check("endpoint without path: legacy bucket strip unchanged", () => assert.equal(keyFromPresignedUrl(`https://minio.test/faithflow-media/${KEY}?X-Amz-Signature=a`), KEY));
  console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1);
}
void main();
