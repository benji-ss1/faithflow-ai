/**
 * Login lockout guard (charge-first) + sign-in error copy. Run: npx tsx test/login-guard.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LOGIN_IP_LIMIT, LOGIN_EMAIL_LIMIT, LOGIN_IP_EMAIL_LIMIT,
  chargeLoginAttempt, loginLockedFor, refundLoginSuccess,
  InvalidCredentialsError, RateLimitedError,
  LOGIN_MAX_KEYS, loginGuardSize, normalizeIp, clientIpFromHeaders, LOGIN_MAX_IP_LEN,
  LOGIN_MAX_LOCKS, loginLockCount, LOGIN_WINDOW_MS as LOGIN_WINDOW_MS_TEST,
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
  await check("limits are 50 / 5 / 5", () => {
    assert.equal(LOGIN_IP_LIMIT, 50); assert.equal(LOGIN_EMAIL_LIMIT, 5); assert.equal(LOGIN_IP_EMAIL_LIMIT, 5);
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

  await check("200 PARALLEL wrong attempts across emails, one IP → exactly 50 checked", async () => {
    const rs = await Promise.all(Array.from({ length: 200 }, (_, i) => attempt("10.2.0.2", `p${i}@x.org`, false)));
    assert.equal(rs.filter((r) => r === "inv").length, 50);
  });

  await check("locked attempt is not charged (does not extend / over-count)", async () => {
    const ip = "10.2.0.3", e = "lk@x.org";
    for (let i = 0; i < 20; i++) await attempt(ip, e, false);
    // IP bucket holds only the 5 checked attempts, so 45 more other-email attempts fit.
    let ok = 0; for (let i = 0; i < 50; i++) if ((await attempt(ip, `o${i}@x.org`, false)) === "inv") ok++;
    assert.equal(ok, 45);
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
    for (let i = 0; i < 49; i++) await attempt(ip, `v${i}@x.org`, false);
    assert.equal(await attempt(ip, "good@x.org", true), "ok"); // charged to 50, refunded to 49
    assert.equal(loginLockedFor(ip, "other@x.org"), null);
    await attempt(ip, "v49@x.org", false); // 50
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

  await check("IPv6 → /64, IPv4-mapped → IPv4, IPv4 unchanged", async () => {
    assert.equal(normalizeIp("1.2.3.4"), "1.2.3.4");
    assert.equal(normalizeIp("::ffff:1.2.3.4"), "1.2.3.4");
    assert.equal(normalizeIp("[::FFFF:10.0.0.9]"), "10.0.0.9");
    assert.equal(normalizeIp("2001:db8:1:2:aaaa:bbbb:cccc:dddd"), "2001:db8:1:2::/64");
    assert.equal(normalizeIp("2001:0db8:0001:0002::1"), "2001:db8:1:2::/64");
    assert.equal(normalizeIp("2001:db8::1"), "2001:db8:0:0::/64");
    assert.equal(normalizeIp("fe80::1%eth0"), "fe80:0:0:0::/64");
    assert.equal(normalizeIp("unknown"), "unknown");
    // rotating the interface id within one /64 shares the per-IP+email bucket
    for (let i = 0; i < 5; i++) await attempt(`2001:db8:9:9::${i + 1}`, "v6@x.org", false);
    assert.notEqual(loginLockedFor("2001:db8:9:9::abcd", "v6@x.org"), null);
    for (let i = 0; i < 50; i++) await attempt(`2001:db8:7:7::${i + 1}`, `v6i${i}@x.org`, false);
    assert.notEqual(loginLockedFor("2001:db8:7:7::beef", "fresh@x.org"), null, "per-IP bucket is /64-wide");
    assert.equal(loginLockedFor("2001:db8:7:8::1", "fresh@x.org"), null, "other /64 unaffected");
  });

  await check("client IP header precedence: vercel → real-ip → first xff → unknown", () => {
    const H = (o: Record<string, string>) => new Headers(o);
    assert.equal(clientIpFromHeaders(H({ "x-vercel-forwarded-for": "1.1.1.1", "x-real-ip": "2.2.2.2", "x-forwarded-for": "3.3.3.3, 4.4.4.4" })), "1.1.1.1");
    assert.equal(clientIpFromHeaders(H({ "x-real-ip": "2.2.2.2", "x-forwarded-for": "3.3.3.3" })), "2.2.2.2");
    assert.equal(clientIpFromHeaders(H({ "x-forwarded-for": " 3.3.3.3 , 4.4.4.4" })), "3.3.3.3");
    assert.equal(clientIpFromHeaders(H({})), "unknown");
    assert.equal(clientIpFromHeaders(undefined), "unknown");
  });

  await check("oversized email/password rejected before charging", () => {
    const src = readFileSync(new URL("../src/lib/auth.ts", import.meta.url), "utf8");
    const g = src.indexOf("email.length > 254 || String(creds.password).length > 1024) throw new InvalidCredentialsError()");
    const k = src.indexOf("chargeLoginAttempt(ip, email)");
    assert.ok(g > 0 && k > g, "length guard must precede the charge");
  });

  await check("100k random-key flood: map capped, O(1) per attempt, targeted account still limited", async () => {
    let checked = 0;
    for (let i = 0; i < 100_000; i++) {
      chargeLoginAttempt(`f${i}.${(Math.random() * 1e9) | 0}`, `r${(Math.random() * 1e9) | 0}@x`);
      if (i % 5000 === 0 && chargeLoginAttempt(`t${i}`, "target@x.org") === null) checked++;
      assert.ok(loginGuardSize() <= LOGIN_MAX_KEYS);
    }
    assert.equal(checked, 5, `targeted account checked ${checked}x`);
    assert.ok(loginGuardSize() <= LOGIN_MAX_KEYS);
    const t = performance.now();
    for (let i = 0; i < 1000; i++) chargeLoginAttempt(`z${i}`, `zz${i}@x`);
    const ms = performance.now() - t;
    assert.ok(ms < 50, `1000 attempts took ${ms.toFixed(1)}ms`);
  });

  await check("normalizeIp: oversize/pathological input is fast + bounded", () => {
    for (const bad of [":".repeat(16_000), "0:".repeat(8_000), "0:".repeat(8_000) + "ffff:1.2.3.4x"]) {
      const t0 = performance.now();
      const out = normalizeIp(bad);
      assert.ok(performance.now() - t0 < 5, "must complete < 5ms");
      assert.equal(out, "invalid-ip");
    }
    assert.ok(normalizeIp("a".repeat(LOGIN_MAX_IP_LEN)).length <= LOGIN_MAX_IP_LEN);
    for (let n = 1; n <= 40; n++) { const t0 = performance.now(); normalizeIp("0:".repeat(n) + "x"); assert.ok(performance.now() - t0 < 5); }
  });

  await check("normalizeIp: structurally invalid IPv6 never merges into a /64", () => {
    assert.equal(normalizeIp("1::2::3"), "1::2::3");
    assert.notEqual(normalizeIp("2001:db8::1::1"), normalizeIp("2001:db8::1"));
    assert.equal(normalizeIp("::1.2.3.4"), "0:0:0:0::/64"); // embedded quad groups by /64 (b58aa6d parity)
    assert.equal(normalizeIp("1:2:3:4:5:6:7:8:9"), "1:2:3:4:5:6:7:8:9");
    assert.equal(normalizeIp("1:2:3:4::5:6:7:8"), "1:2:3:4::5:6:7:8");
    assert.equal(normalizeIp("::ffff:1.2.3.999"), "::ffff:1.2.3.999");
    assert.equal(normalizeIp("0:0:0:0:0:ffff:1.2.3.4"), "1.2.3.4");
  });

  await check("eviction: junk-key flood cannot wipe an active lock", () => {
    const ip = "203.0.113.77", email = "locked-target@x";
    for (let i = 0; i < LOGIN_IP_EMAIL_LIMIT; i++) chargeLoginAttempt(ip, email);
    assert.notEqual(loginLockedFor(ip, email), null);
    for (let i = 0; i < 100_000; i++) chargeLoginAttempt(`198.51.${(i >> 8) & 255}.${i & 255}`, `junk${i}@x`);
    assert.ok(loginGuardSize() <= LOGIN_MAX_KEYS);
    assert.notEqual(loginLockedFor(ip, email), null);
  });

  await check("counter-age: 4 wrong + 50k fresh junk keys cannot reset the target's count; 5th wrong locks", () => {
    const v4 = (i: number) => `${(i >>> 24) & 255}.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;
    const target = "age-victim@x";
    for (let i = 0; i < 4; i++) assert.equal(chargeLoginAttempt(v4(0x61000000 + i), target), null);
    for (let i = 0; i < 50_000; i++) chargeLoginAttempt(v4(0x62000000 + i), `aj${i}@x`);
    assert.ok(loginGuardSize() <= LOGIN_MAX_KEYS);
    assert.equal(chargeLoginAttempt(v4(0x63000000), target), null, "5th guess allowed");
    assert.notEqual(chargeLoginAttempt(v4(0x63000001), target), null, "6th must be locked (count was not reset)");
  });

  await check("counter-age: wiping a count-4 counter needs ≥ ~68k attempts of count-4 email junk (batch evict → ~18k × 4)", () => {
    const v4 = (i: number) => `${(i >>> 24) & 255}.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;
    const target = "age-victim2@x"; let ipn = 0x64000000;
    for (let i = 0; i < 4; i++) chargeLoginAttempt(v4(ipn++), target);
    // cheapest junk at count 4: fresh IP per attempt, 4 hits per email. 17k emails = 68k attempts (measured wipe ≈ 72-74k).
    for (let e = 0; e < 17_000; e++) for (let j = 0; j < 4; j++) chargeLoginAttempt(v4(ipn++), `aw${e}@x`);
    assert.ok(loginGuardSize() <= LOGIN_MAX_KEYS);
    assert.equal(chargeLoginAttempt(v4(ipn++), target), null);
    assert.notEqual(loginLockedFor("0.0.0.1", target), null, "count-4 target survived 68k attempts → 5th locks");
  });

  await check("lock-everything flood (2,000 IPs × 6 emails × 5): target stays locked, attempts stay O(1)", () => {
    const v4 = (i: number) => `${(i >>> 24) & 255}.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;
    const target = "flood-victim@x"; let idx = 1;
    while (chargeLoginAttempt(v4(0x5a000000 + idx++), target) === null);
    assert.equal(idx, 7, "target locked after exactly 5 checks");
    for (let ip = 0; ip < 2000; ip++) for (let m = 0; m < 6; m++) for (let j = 0; j < 5; j++) chargeLoginAttempt(v4(0x2d000000 + ip), `L${ip}-${m}@x`);
    assert.ok(loginGuardSize() <= LOGIN_MAX_KEYS && loginLockCount() <= LOGIN_MAX_LOCKS);
    assert.notEqual(chargeLoginAttempt(v4(0x5b000001), target), null, "target must still be locked");
    const ts: number[] = []; const t0 = performance.now();
    for (let i = 0; i < 1000; i++) { const t = performance.now(); chargeLoginAttempt(v4(0x4d000000 + i), `n${i}@x`); ts.push(performance.now() - t); }
    const total = performance.now() - t0; ts.sort((a, b) => a - b);
    assert.ok(total < 50, `1000 attempts took ${total.toFixed(1)}ms`);
    assert.ok(ts[989] < 0.1, `p99 ${ts[989].toFixed(3)}ms`);
    let extra = 0; for (let i = 0; i < 100; i++) if (chargeLoginAttempt(v4(0x5c000000 + i), target) === null) extra++;
    assert.equal(extra, 0);
  });

  await check("lock store: bound respected, expired locks dropped, email lock outlives IP-scoped pressure", () => {
    const realNow = Date.now; let now = realNow() + 3 * LOGIN_WINDOW_MS_TEST; Date.now = () => now;
    try {
      for (let i = 0; i < 5; i++) chargeLoginAttempt(`172.16.0.${i}`, "old-lock@x");
      now += LOGIN_WINDOW_MS_TEST + 1; // old-lock now expired
      for (let i = 0; i < 5; i++) chargeLoginAttempt(`172.17.0.${i}`, "keep@x"); // earliest LIVE lockedUntil
      now += 1000;
      // each fresh email from its own /64 → 1 email lock + 1 IP+email lock; 70k locks total > cap,
      // email locks (35k) stay under cap so only IP-scoped locks may be evicted.
      for (let i = 0; i < LOGIN_MAX_LOCKS / 2 + 10_000; i++) {
        const ip = `2001:db8:${(i >> 16).toString(16)}:${(i & 0xffff).toString(16)}::1`;
        for (let j = 0; j < 5; j++) chargeLoginAttempt(ip, `pk${i}@x`);
        if (i % 1000 === 0) assert.ok(loginLockCount() <= LOGIN_MAX_LOCKS);
      }
      assert.ok(loginLockCount() <= LOGIN_MAX_LOCKS);
      assert.notEqual(loginLockedFor("9.9.9.9", "keep@x"), null, "live email lock survived");
      assert.equal(loginLockedFor("9.9.9.9", "old-lock@x"), null, "expired lock gone");
    } finally { Date.now = realNow; }
  });

  await check("normalizeIp: non-::ffff embedded dotted quad groups by /64 exactly like b58aa6d", () => {
    // b58aa6d reference implementation (regex) — test-only oracle.
    const ref = (raw: string) => {
      let ip = raw.trim().toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
      if (!ip.includes(":")) return ip;
      const mapped = /^(?:0*:)*:?(?:0*:)*ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
      if (mapped) return mapped[1];
      const v4tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
      if (v4tail) { const [a, b, c, d] = v4tail[1].split(".").map(Number); ip = ip.slice(0, -v4tail[1].length) + ((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16); }
      const [head, tail] = ip.split("::"); const hg = head ? head.split(":") : []; const tg = tail ? tail.split(":") : [];
      const groups = ip.includes("::") ? [...hg, ...Array(Math.max(0, 8 - hg.length - tg.length)).fill("0"), ...tg] : hg;
      if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return ip;
      return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
    };
    assert.equal(normalizeIp("2001:db8:1:1::1.2.3.4"), "2001:db8:1:1::/64");
    assert.equal(normalizeIp("64:ff9b::1.2.3.4"), "64:ff9b:0:0::/64");
    assert.equal(normalizeIp("::1.2.3.4"), "0:0:0:0::/64");
    assert.equal(normalizeIp("1:2:3:4:5:6:1.2.3.4"), "1:2:3:4::/64");
    assert.equal(normalizeIp("::ffff:1.2.3.4"), "1.2.3.4");
    let s = 12345; const r = (n: number) => ((s = (s * 1103515245 + 12345) % 2 ** 31) % n);
    const hx = () => r(65536).toString(16), q = () => `${r(256)}.${r(256)}.${r(256)}.${r(256)}`;
    let n = 0;
    for (let i = 0; i < 5000; i++) {
      const g = Array.from({ length: 6 }, hx);
      const forms = [
        `${g.join(":")}:${q()}`, `${g.slice(0, 4).join(":")}::${q()}`, `${g.slice(0, 1 + r(5)).join(":")}::${q()}`,
        `::${q()}`, `64:ff9b::${q()}`, `[${g.slice(0, 4).join(":")}::${hx()}:${q()}]`, g.concat(hx(), hx()).join(":"),
        `::ffff:${q()}`, `0:0:0:0:0:ffff:${q()}`,
      ];
      for (const f of forms) { assert.equal(normalizeIp(f), ref(f), f); n++; }
    }
    assert.equal(n, 45_000);
  });

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
