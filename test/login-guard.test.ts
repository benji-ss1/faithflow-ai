/**
 * Login lockout guard (charge-first) + sign-in error copy. Run: npx tsx test/login-guard.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LOGIN_IP_LIMIT, LOGIN_EMAIL_LIMIT, LOGIN_IP_EMAIL_LIMIT,
  chargeLoginAttempt, loginLockedFor, refundLoginSuccess,
  InvalidCredentialsError, RateLimitedError,
} from "../src/lib/login-guard";
import { signInErrorMessage, normalizeEmail } from "../src/lib/auth-error-message";
import { CredentialsSignin } from "next-auth";

let pass = 0, fail = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); fail++; }
}
const tick = () => new Promise((r) => setTimeout(r, 1));
// Mirrors authorize(): charge synchronously, then await "bcrypt", then outcome.
async function attempt(ip: string, email: string, correct: boolean) {
  const locked = chargeLoginAttempt(ip, email);
  if (locked !== null) return "rl";
  await tick();
  if (correct) { refundLoginSuccess(ip, email); return "ok"; }
  return "inv";
}

(async () => {
  await check("limits are 30 / 5 / 5", () => {
    assert.equal(LOGIN_IP_LIMIT, 30); assert.equal(LOGIN_EMAIL_LIMIT, 5); assert.equal(LOGIN_IP_EMAIL_LIMIT, 5);
  });

  await check("one person's 5 typos lock only them, not a colleague on the same IP", async () => {
    const ip = "10.0.0.1";
    for (let i = 0; i < 5; i++) await attempt(ip, "a@church.org", false);
    const m = loginLockedFor(ip, "a@church.org");
    assert.ok(m !== null && m >= 1 && m <= 15, `locked minutes ${m}`);
    assert.equal(loginLockedFor(ip, "b@church.org"), null);
  });

  await check("4 failures do not lock", async () => {
    for (let i = 0; i < 4; i++) await attempt("10.0.0.2", "c@church.org", false);
    assert.equal(loginLockedFor("10.0.0.2", "c@church.org"), null);
  });

  await check("per-email lock applies from a different IP", async () => {
    for (let i = 0; i < 5; i++) await attempt(`10.1.0.${i}`, "d@church.org", false);
    assert.notEqual(loginLockedFor("10.9.9.9", "d@church.org"), null);
  });

  await check("50 PARALLEL wrong attempts on one account → exactly 5 checked", async () => {
    const rs = await Promise.all(Array.from({ length: 50 }, () => attempt("10.2.0.1", "par@church.org", false)));
    assert.equal(rs.filter((r) => r === "inv").length, 5);
    assert.equal(rs.filter((r) => r === "rl").length, 45);
  });

  await check("200 PARALLEL wrong attempts across emails, one IP → exactly 30 checked", async () => {
    const rs = await Promise.all(Array.from({ length: 200 }, (_, i) => attempt("10.2.0.2", `p${i}@x.org`, false)));
    assert.equal(rs.filter((r) => r === "inv").length, 30);
  });

  await check("locked attempt is not charged (does not extend / over-count)", async () => {
    const ip = "10.2.0.3", e = "lk@x.org";
    for (let i = 0; i < 20; i++) await attempt(ip, e, false);
    // IP bucket holds only the 5 checked attempts, so 25 more other-email attempts fit.
    let ok = 0; for (let i = 0; i < 30; i++) if ((await attempt(ip, `o${i}@x.org`, false)) === "inv") ok++;
    assert.equal(ok, 25);
  });

  await check("success clears email + IP+email counters", async () => {
    const ip = "10.0.0.4", e = "e@church.org";
    for (let i = 0; i < 4; i++) await attempt(ip, e, false);
    assert.equal(await attempt(ip, e, true), "ok");
    for (let i = 0; i < 4; i++) await attempt(ip, e, false);
    assert.equal(loginLockedFor(ip, e), null);
  });

  await check("success refunds only its own IP charge, not other IP failures", async () => {
    const ip = "10.0.0.5";
    for (let i = 0; i < 29; i++) await attempt(ip, `v${i}@x.org`, false);
    assert.equal(await attempt(ip, "good@x.org", true), "ok"); // charged to 30, refunded to 29
    assert.equal(loginLockedFor(ip, "other@x.org"), null);
    await attempt(ip, "v29@x.org", false); // 30
    assert.notEqual(loginLockedFor(ip, "other@x.org"), null);
  });

  await check("parallel: correct login among parallel wrong ones still limits to 5 total checks", async () => {
    const rs = await Promise.all([
      ...Array.from({ length: 10 }, () => attempt("10.2.0.4", "mix@x.org", false)),
      attempt("10.2.0.4", "mix@x.org", true),
    ]);
    assert.equal(rs.filter((r) => r !== "rl").length, 5);
  });

  await check("error classes carry distinct codes and are CredentialsSignin", () => {
    const a = new InvalidCredentialsError(); const b = new RateLimitedError(12);
    assert.ok(a instanceof CredentialsSignin && b instanceof CredentialsSignin);
    assert.equal(a.code, "invalid_credentials");
    assert.equal(b.code, "rate_limited:12");
  });

  await check("TOTP-enabled correct password throws InvalidCredentialsError (no oracle), keeps charge", () => {
    const src = readFileSync(new URL("../src/lib/auth.ts", import.meta.url), "utf8");
    assert.match(src, /if \(user\.totpEnabled\) throw new InvalidCredentialsError\(\);/);
    const i = src.indexOf("user.totpEnabled"), j = src.indexOf("refundLoginSuccess(ip, email)");
    assert.ok(i > 0 && j > i, "refund must come after the TOTP guard");
    const k = src.indexOf("chargeLoginAttempt(ip, email)"), dbAt = src.indexOf("getDb()", k);
    assert.ok(k > 0 && dbAt > k && !src.slice(k, dbAt).includes("await"), "charge must precede any await");
  });

  await check("client message mapping", () => {
    assert.equal(signInErrorMessage("rate_limited:12"), "Too many sign-in attempts — try again in 12 minutes, or reset your password.");
    assert.doesNotMatch(signInErrorMessage("rate_limited:12"), /network/);
    assert.match(signInErrorMessage("rate_limited:1"), /in 1 minute,/);
    assert.match(signInErrorMessage("rate_limited"), /in 15 minutes/);
    assert.match(signInErrorMessage("rate_limited:0"), /in 1 minute,/);
    assert.match(signInErrorMessage("rate_limited:99999999999999999999"), /in 15 minutes/);
    assert.equal(signInErrorMessage("invalid_credentials"), "Email or password is incorrect.");
    for (const c of ["credentials", undefined, null, "", "MissingCSRF", "rate_limitedX", "rate_limited:NaN", "rate_limited:-1", "rate_limited:", "rate_limited:1.5"]) {
      assert.equal(signInErrorMessage(c as string), "Sign-in failed — please try again.", String(c));
    }
  });

  await check("normalizeEmail trims + lowercases", () => {
    assert.equal(normalizeEmail("  Pastor@Church.ORG \n"), "pastor@church.org");
  });

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
