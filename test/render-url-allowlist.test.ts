// Relative-path allowlist + auth-GET navigation guard (2026-09-14 security gate).
// Run: npx tsx test/render-url-allowlist.test.ts
import assert from "node:assert/strict";
import { cleanRenderUrl, isRenderableUrl } from "../src/lib/render-url";
import { isTopLevelNavigation } from "../src/lib/fetch-metadata";

const ok = [
  "/api/media/95f5dd86-dc58-4674-9bd1-ca8af7d8abbc",
  "/api/media/abc-123/file.png",
  "/marketing/how-show.jpg",
  "/brand/pf-logo-mark.png",
  "/login/slide-1.png",
];
const bad = [
  "/api/auth/device-exchange?token=abc",
  "/api/auth/device-exchange",
  "/api/dev-login",
  "/operator",
  "/api/media/",
  "/api/media/x?token=1",
  "/api/media/x#frag",
  "/api/media/../auth/device-exchange",
  "/marketing/./x.jpg",
  "/api/media/%2e%2e/auth/device-exchange",
  "/api/media/%2E%2E%2Fauth",
  "/api/media/a%2fb",
  "/api/media/a%5Cb",
  "/api/mediax/1",
  "/livestream",
];
for (const u of ok) { assert.equal(cleanRenderUrl(u), u, u); assert.equal(isRenderableUrl(u), true, u); }
for (const u of bad) { assert.equal(cleanRenderUrl(u), null, u); assert.equal(isRenderableUrl(u), false, u); }

const h = (o: Record<string, string>) => ({ get: (k: string) => o[k.toLowerCase()] ?? null });
assert.equal(isTopLevelNavigation(h({ "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" })), true);
assert.equal(isTopLevelNavigation(h({})), true); // legacy client without Fetch Metadata
assert.equal(isTopLevelNavigation(h({ "sec-fetch-dest": "image", "sec-fetch-mode": "no-cors" })), false);
assert.equal(isTopLevelNavigation(h({ "sec-fetch-dest": "empty", "sec-fetch-mode": "cors" })), false);
assert.equal(isTopLevelNavigation(h({ "sec-fetch-dest": "iframe", "sec-fetch-mode": "navigate" })), false);
assert.equal(isTopLevelNavigation(h({ "sec-fetch-dest": "document", "sec-fetch-mode": "no-cors" })), false);
console.log(`render-url-allowlist: ${ok.length + bad.length + 6} assertions passed`);
