// Relative-path allowlist + auth-GET navigation guard (2026-09-14 security gate).
// Run: npx tsx test/render-url-allowlist.test.ts
import assert from "node:assert/strict";
import { cleanRenderUrl, isRenderableUrl } from "../src/lib/render-url";
import { isTopLevelNavigation } from "../src/lib/fetch-metadata";

const ok = [
  "/api/media/95f5dd86-dc58-4674-9bd1-ca8af7d8abbc",
  "/api/media/95f5dd86-dc58-4674-9bd1-ca8af7d8abbc/file.png",
  "/marketing/bring-library.mp4",
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
  "/api/media/list",
  "/api/media/list/",
  "/api/media/presign",
  "/api/media/95f5dd86-dc58-4674-9bd1-ca8af7d8abbc/",
  "/api/media/95f5dd86-dc58-4674-9bd1-ca8af7d8abbc/a/b.png",
  "/api/media/%252e%252e/auth",
  "/marketing/%252e%252e/x.jpg",
  "/marketing/",
  "/marketing/page",
  "/brand/logo.svg",
  "/login/slide-1.png/",
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
assert.equal(isTopLevelNavigation(h({ "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "sec-fetch-site": "cross-site" })), false);
assert.equal(isTopLevelNavigation(h({ "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "sec-fetch-site": "same-site" })), false);
assert.equal(isTopLevelNavigation(h({ "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "sec-fetch-site": "same-origin" })), true);
assert.equal(isTopLevelNavigation(h({ "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "sec-fetch-site": "none" })), true);
assert.equal(isTopLevelNavigation(h({ "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "sec-fetch-site": "same-origin", "sec-purpose": "prefetch" })), false);
assert.equal(isTopLevelNavigation(h({ "sec-purpose": "prefetch;prerender" })), false);
console.log(`render-url-allowlist: ${ok.length + bad.length + 12} assertions passed`);
