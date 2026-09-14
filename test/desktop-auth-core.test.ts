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
  assert.equal(core.decideExchange(null, "u1"), "exchange");
  assert.equal(core.decideExchange("u1", "u1"), "same-user");
  assert.equal(core.decideExchange("victim", "attacker"), "confirm");
  assert.equal(core.decideExchange("u1", null), "invalid");
  assert.equal(core.decideExchange(null, null), "invalid");
});
check("isSameOriginPost", () => {
  const h = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
  assert.equal(core.isSameOriginPost(h({ origin: "https://presentflow.org", host: "presentflow.org", "sec-fetch-site": "same-origin" })), true);
  assert.equal(core.isSameOriginPost(h({ origin: "https://evil.com", host: "presentflow.org" })), false);
  assert.equal(core.isSameOriginPost(h({ origin: "https://presentflow.org", host: "presentflow.org", "sec-fetch-site": "cross-site" })), false);
  assert.equal(core.isSameOriginPost(h({ host: "presentflow.org" })), false);
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
