/**
 * Login lockout guard + sign-in error copy. Run: npx tsx test/login-guard.test.ts
 */
import assert from "node:assert/strict";
import {
  LOGIN_IP_LIMIT, LOGIN_EMAIL_LIMIT, LOGIN_IP_EMAIL_LIMIT,
  loginLockedFor, recordLoginFailure, recordLoginSuccess,
  InvalidCredentialsError, RateLimitedError,
} from "../src/lib/login-guard";
import { signInErrorMessage, normalizeEmail } from "../src/lib/auth-error-message";
import { CredentialsSignin } from "next-auth";

let pass = 0, fail = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}

(async () => {
  await check("limits are 30 / 5 / 5", () => {
    assert.equal(LOGIN_IP_LIMIT, 30); assert.equal(LOGIN_EMAIL_LIMIT, 5); assert.equal(LOGIN_IP_EMAIL_LIMIT, 5);
  });

  await check("one person's 5 typos lock only them, not a colleague on the same IP", async () => {
    const ip = "10.0.0.1";
    for (let i = 0; i < 5; i++) await recordLoginFailure(ip, "a@church.org");
    const m = await loginLockedFor(ip, "a@church.org");
    assert.ok(m !== null && m >= 1 && m <= 15, `locked minutes ${m}`);
    assert.equal(await loginLockedFor(ip, "b@church.org"), null);
  });

  await check("4 failures do not lock", async () => {
    for (let i = 0; i < 4; i++) await recordLoginFailure("10.0.0.2", "c@church.org");
    assert.equal(await loginLockedFor("10.0.0.2", "c@church.org"), null);
  });

  await check("per-email lock applies from a different IP", async () => {
    for (let i = 0; i < 5; i++) await recordLoginFailure(`10.1.0.${i}`, "d@church.org");
    assert.notEqual(await loginLockedFor("10.9.9.9", "d@church.org"), null);
  });

  await check("per-IP locks at 30 failures across many emails, not at 29", async () => {
    const ip = "10.0.0.3";
    for (let i = 0; i < 29; i++) await recordLoginFailure(ip, `u${i}@x.org`);
    assert.equal(await loginLockedFor(ip, "fresh@x.org"), null);
    await recordLoginFailure(ip, "u29@x.org");
    assert.notEqual(await loginLockedFor(ip, "fresh@x.org"), null);
  });

  await check("success clears email + IP+email counters", async () => {
    const ip = "10.0.0.4", e = "e@church.org";
    for (let i = 0; i < 4; i++) await recordLoginFailure(ip, e);
    await recordLoginSuccess(ip, e);
    for (let i = 0; i < 4; i++) await recordLoginFailure(ip, e);
    assert.equal(await loginLockedFor(ip, e), null);
  });

  await check("success does NOT clear the per-IP counter", async () => {
    const ip = "10.0.0.5";
    for (let i = 0; i < 30; i++) await recordLoginFailure(ip, `v${i}@x.org`);
    await recordLoginSuccess(ip, "v0@x.org");
    assert.notEqual(await loginLockedFor(ip, "other@x.org"), null);
  });

  await check("error classes carry distinct codes and are CredentialsSignin", () => {
    const a = new InvalidCredentialsError(); const b = new RateLimitedError(12);
    assert.ok(a instanceof CredentialsSignin && b instanceof CredentialsSignin);
    assert.equal(a.code, "invalid_credentials");
    assert.equal(b.code, "rate_limited:12");
  });

  await check("client message mapping", () => {
    assert.match(signInErrorMessage("rate_limited:12"), /Too many sign-in attempts from this network — try again in 12 minutes, or reset your password/);
    assert.match(signInErrorMessage("rate_limited:1"), /in 1 minute,/);
    assert.match(signInErrorMessage("rate_limited"), /15 minutes/);
    assert.equal(signInErrorMessage("invalid_credentials"), "Email or password is incorrect.");
    for (const c of ["credentials", undefined, null, "", "MissingCSRF", "rate_limitedX"]) {
      assert.equal(signInErrorMessage(c as string), "Sign-in failed — please try again.");
    }
  });

  await check("normalizeEmail trims + lowercases", () => {
    assert.equal(normalizeEmail("  Pastor@Church.ORG \n"), "pastor@church.org");
  });

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
