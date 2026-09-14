/**
 * Desktop auto sign-in pure primitives. Run: npx tsx test/desktop-auth-core.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as core from "../src/lib/desktop-auth-core";

// Secret is read lazily per call, so setting it after import is fine.
process.env.AUTH_SECRET = process.env.AUTH_SECRET || "unit-test-secret";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}

check("pair code: 8 chars from alphabet, normalizes formatted input", () => {
  for (let i = 0; i < 200; i++) {
    const c = core.generatePairCode();
    assert.equal(c.length, 8);
    assert.equal(core.normalizePairCode(core.formatPairCode(c).toLowerCase()), c);
    assert.equal(core.normalizePairCode(` ${c.slice(0, 4)} ${c.slice(4)} `), c);
  }
});
check("pair code: rejects wrong length / confusables / non-strings", () => {
  assert.equal(core.normalizePairCode("ABCD-EFG"), null);
  assert.equal(core.normalizePairCode("ABCD-EFGO"), null);
  assert.equal(core.normalizePairCode("ABCD-EF01"), null);
  assert.equal(core.normalizePairCode(123), null);
  assert.equal(core.normalizePairCode("A".repeat(100)), null);
  assert.equal(core.normalizePairCode("LLLL-LLLL"), "LLLLLLLL");
});
check("ticket: roundtrip binds to code hash", () => {
  const c = core.generatePairCode();
  const t = core.signPairTicket(c);
  const v = core.verifyPairTicket(t.ticket);
  assert.ok(v);
  assert.equal(v!.codeHash, core.pairCodeHash(c));
  assert.equal(v!.nonce, t.nonce);
});
check("ticket: tampered payload / signature rejected", () => {
  const t = core.signPairTicket(core.generatePairCode()).ticket;
  const [body, sig] = t.split(".");
  const forged = Buffer.from(JSON.stringify({ v: 1, h: core.pairCodeHash("AAAAAAAA"), n: "x", e: Date.now() + 1e6 })).toString("base64url");
  assert.equal(core.verifyPairTicket(`${forged}.${sig}`), null);
  assert.equal(core.verifyPairTicket(`${body}.${sig.slice(0, -2)}xx`), null);
  assert.equal(core.verifyPairTicket("garbage"), null);
  assert.equal(core.verifyPairTicket(null), null);
});
check("ticket: expired rejected", () => {
  const t = core.signPairTicket(core.generatePairCode(), Date.now() - core.PAIR_TTL_MS - 1000);
  assert.equal(core.verifyPairTicket(t.ticket), null);
});
check("confirm csrf: bound to session user + token, expires", () => {
  const csrf = core.signExchangeConfirm("user-a", "tok-1");
  assert.equal(core.verifyExchangeConfirm(csrf, "user-a", "tok-1"), true);
  assert.equal(core.verifyExchangeConfirm(csrf, "user-b", "tok-1"), false);
  assert.equal(core.verifyExchangeConfirm(csrf, "user-a", "tok-2"), false);
  assert.equal(core.verifyExchangeConfirm("", "user-a", "tok-1"), false);
  const old = core.signExchangeConfirm("user-a", "tok-1", Date.now() - core.CONFIRM_TTL_MS - 1000);
  assert.equal(core.verifyExchangeConfirm(old, "user-a", "tok-1"), false);
  const [exp, mac] = csrf.split(".");
  assert.equal(core.verifyExchangeConfirm(`${Number(exp) + 99999}.${mac}`, "user-a", "tok-1"), false);
});
check("decideExchange: never silently swaps a different signed-in user", () => {
  assert.equal(core.decideExchange(null, "u1", { pairMarkerValid: true }), "exchange");
  assert.equal(core.decideExchange("u1", "u1"), "same-user");
  assert.equal(core.decideExchange("victim", "attacker"), "confirm");
  assert.equal(core.decideExchange("u1", null), "invalid");
  assert.equal(core.decideExchange(null, null), "invalid");
});
check("decideExchange: no session + deep link (no pairing marker) → confirm-signin", () => {
  assert.equal(core.decideExchange(null, "attacker"), "confirm-signin");
  assert.equal(core.decideExchange(null, "attacker", { pairMarkerValid: false }), "confirm-signin");
});
check("pair exchange marker: bound to token", () => {
  const m = core.signPairExchangeMarker("tok-1");
  assert.equal(core.verifyPairExchangeMarker(m, "tok-1"), true);
  assert.equal(core.verifyPairExchangeMarker(m, "tok-2"), false);
  assert.equal(core.verifyPairExchangeMarker(undefined, "tok-1"), false);
  assert.equal(core.verifyPairExchangeMarker("x".repeat(500), "tok-1"), false);
});
check("anon confirm csrf is not valid for a signed-in user (and vice versa)", () => {
  const anon = core.signExchangeConfirm(core.ANON_CONFIRM_SUBJECT, "tok");
  assert.equal(core.verifyExchangeConfirm(anon, core.ANON_CONFIRM_SUBJECT, "tok"), true);
  assert.equal(core.verifyExchangeConfirm(anon, "user-a", "tok"), false);
});
check("pairCodeHash is keyed by AUTH_SECRET", () => {
  const h1 = core.pairCodeHash("ABCDEFGH");
  const prev = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "different-secret";
  const h2 = core.pairCodeHash("ABCDEFGH");
  process.env.AUTH_SECRET = prev;
  assert.notEqual(h1, h2);
});
check("isSameOriginPost", () => {
  const h = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
  assert.equal(core.isSameOriginPost(h({ origin: "https://presentflow.org", host: "presentflow.org", "sec-fetch-site": "same-origin" })), true);
  assert.equal(core.isSameOriginPost(h({ origin: "https://evil.com", host: "presentflow.org" })), false);
  assert.equal(core.isSameOriginPost(h({ origin: "https://presentflow.org", host: "presentflow.org", "sec-fetch-site": "cross-site" })), false);
  assert.equal(core.isSameOriginPost(h({ host: "presentflow.org" })), false);
});
check("isSameOriginPost: comma-separated x-forwarded-host uses first hop", () => {
  const h = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
  assert.equal(core.isSameOriginPost(h({ origin: "https://presentflow.org", "x-forwarded-host": " presentflow.org , internal.vercel.app", host: "x" })), true);
  assert.equal(core.isSameOriginPost(h({ origin: "https://internal.vercel.app", "x-forwarded-host": "presentflow.org, internal.vercel.app" })), false);
});
check("geo mismatch helper", () => {
  assert.equal(core.isGeoMismatch("NG", "GB"), true);
  assert.equal(core.isGeoMismatch("ng", "NG"), false);
  assert.equal(core.isGeoMismatch(null, "GB"), false);
  assert.equal(core.isGeoMismatch("NG", null), false);
  assert.equal(core.isGeoMismatch(undefined, undefined), false);
});
check("readGeo decodes Vercel headers; strips control/markup chars", () => {
  const h = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
  assert.deepEqual(core.readGeo(h({ "x-vercel-ip-country": "ng", "x-vercel-ip-city": "S%C3%A3o%20Paulo" })), { country: "NG", city: "São Paulo" });
  assert.deepEqual(core.readGeo(h({})), { country: null, city: null });
  assert.equal(core.decodeGeoHeader("%3Cscript%3E"), "script");
  assert.equal(core.decodeGeoHeader("%E0%A4%A"), "%E0%A4%A");
});
check("describeUserAgent / describeLocation", () => {
  assert.equal(core.describeUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) PresentFlow/0.1 Chrome/120 Electron/30 Safari/537.36"), "PresentFlow desktop app on macOS");
  assert.equal(core.describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36 Edg/120"), "Edge on Windows");
  assert.equal(core.describeUserAgent(null), "Unknown device");
  assert.equal(core.describeLocation("Lagos", "NG"), "Lagos, NG");
  assert.equal(core.describeLocation(null, null), "Unknown location");
});
check("sessionTokenVerdict: revocation + 180-day absolute cap", () => {
  const now = Date.now();
  assert.equal(core.sessionTokenVerdict({ authTime: now, tokenVersion: 0, dbVersion: 0, now }), "ok");
  assert.equal(core.sessionTokenVerdict({ authTime: now, tokenVersion: 0, dbVersion: 1, now }), "revoked");
  assert.equal(core.sessionTokenVerdict({ authTime: now - core.SESSION_ABSOLUTE_MAX_MS - 1, tokenVersion: 0, dbVersion: 0, now }), "expired");
  assert.equal(core.sessionTokenVerdict({ authTime: now - core.SESSION_ABSOLUTE_MAX_MS + 60_000, now }), "ok");
  assert.equal(core.sessionTokenVerdict({ authTime: "garbage", now }), "expired");
  // legacy token (no authTime / sv): ok unless DB version moved on
  assert.equal(core.sessionTokenVerdict({ now }), "ok");
  assert.equal(core.sessionTokenVerdict({ dbVersion: 0, now }), "ok");
  assert.equal(core.sessionTokenVerdict({ dbVersion: 2, now }), "revoked");
});
check("source guards: pages no longer mint device links during render; session is rolling 90d", () => {
  for (const f of ["src/app/onboarding/download/page.tsx", "src/app/(app)/settings/download/page.tsx", "src/app/(app)/dashboard/page.tsx"]) {
    assert.ok(!readFileSync(f, "utf8").includes("mintDeviceLinkToken"), `${f} still mints on render`);
  }
  const a = readFileSync("src/lib/auth.ts", "utf8");
  assert.match(a, /maxAge: 90 \* 24 \* 60 \* 60/);
  const r = readFileSync("src/app/api/auth/device-exchange/route.ts", "utf8");
  assert.match(r, /isTopLevelNavigation/);
  assert.match(r, /frame-ancestors 'none'/);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
