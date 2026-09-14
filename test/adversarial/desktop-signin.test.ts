// Adversarial tests for desktop auto sign-in (pairing + device-link).
//
// RUN (LOCAL DB ONLY)
//   npx tsx --env-file=.env.local test/adversarial/desktop-signin.test.ts
//
// Proves:
//   1. An unapproved pairing code can't be exchanged (poll stays pending).
//   2. Approval is single-use: poll after consumption → invalid.
//   3. Expired tickets rejected; forged tickets rejected.
//   4. Cross-church: B cannot re-point A's approval ("already approved").
//   5. A ticket for code X never receives an approval made for code Y.
//   6. Exchange tokens single-use + resolve to the approver.
//   7. Password reset / sign-out-all revoke device_link, pending pairings AND
//      bump session_version (existing JWTs verdict "revoked").
//   8. Account swap / no-session deep link → confirm (never silent).
//   9. RACE: 20 concurrent approvals from 20 users → exactly one wins, desktop
//      signs in as that user.
//  10. Re-approve after claim: same user idempotent; after consumption refused.
//  11. Pairing request records device metadata; code stored only as keyed HMAC.
//  12. 180-day absolute cap.
//  13. RACE: reset concurrent with a desktop mid-poll → no device_link token
//      issued around the reset survives it (200 randomized runs).
//  14. Poll on a revoked/expired pairing row → "expired" (desktop stops, "Start again").

import { eq, inArray } from "drizzle-orm";
import { getDb } from "../../src/lib/db/client";
import { churches, users, authTokens, devicePairRequests } from "../../src/lib/db/schema";
import { consumeAuthToken, issueAuthToken, peekAuthTokenUser, mintToken } from "../../src/lib/auth-tokens";
import { approvePairingForUser, lookupPairingRequest, pollPairing, startPairing } from "../../src/lib/desktop-pair";
import { revokeAllSessionsForUser } from "../../src/lib/session-revocation";
import { resetPassword } from "../../src/lib/auth-actions";
import {
  PAIR_TTL_MS,
  SESSION_ABSOLUTE_MAX_MS,
  decideExchange,
  generatePairCode,
  pairCodeHash,
  sessionTokenVerdict,
  signPairTicket,
} from "../../src/lib/desktop-auth-core";
import crypto from "node:crypto";

if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
  console.error("Refusing to run: DATABASE_URL is not a local database.");
  process.exit(2);
}

type Attempt = { name: string; pass: boolean; detail: string };
const results: Attempt[] = [];
function record(name: string, pass: boolean, detail = "") {
  results.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

const seeded: { churchId: string; userId: string }[] = [];
async function seed(label: string) {
  const db = getDb();
  const [ch] = await db.insert(churches).values({ name: `Adversarial ${label}`, timezone: "UTC" }).returning();
  const [u] = await db.insert(users).values({
    churchId: ch.id,
    email: `desktop-signin-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.invalid`,
    passwordHash: "not-a-real-hash",
    name: `Desktop ${label}`,
  }).returning();
  const s = { churchId: ch.id, userId: u.id };
  seeded.push(s);
  return s;
}

async function sessionVersionOf(userId: string): Promise<number> {
  const [r] = await getDb().select({ v: users.sessionVersion }).from(users).where(eq(users.id, userId));
  return r.v;
}

const codeHashes: string[] = [];
async function start(meta = {}) {
  const p = await startPairing(meta);
  codeHashes.push(pairCodeHash(p.code));
  return p;
}

async function main() {
  const A = await seed("A");
  const B = await seed("B");
  try {
    // 11. metadata + keyed hash
    const p1 = await start({ ip: "203.0.113.9", userAgent: "Mozilla/5.0 (Windows NT 10.0) PresentFlow/1.0 Electron/30", country: "NG", city: "Lagos" });
    const [row] = await getDb().select().from(devicePairRequests).where(eq(devicePairRequests.codeHash, pairCodeHash(p1.code)));
    record("start records pairing request with ip/ua/geo", !!row && row.ip === "203.0.113.9" && row.country === "NG" && row.city === "Lagos");
    const unkeyed = crypto.createHash("sha256").update(`device_pair:${p1.code}`).digest("hex");
    record("code hash is keyed (not plain sha256)", row?.codeHash !== unkeyed);
    const look = await lookupPairingRequest(A.userId, p1.displayCode);
    record("lookup shows requesting device + location", look.ok && look.request.device.includes("Windows") && look.request.location === "Lagos, NG", JSON.stringify(look));

    // 1. unapproved
    const r1 = await pollPairing(p1.ticket);
    record("unapproved code stays pending (no token)", r1.status === "pending", JSON.stringify(r1));

    // 4 + 10. cross-church re-point + idempotence
    const okA = await approvePairingForUser(A.userId, p1.displayCode);
    record("church A user approves own code (first approval)", okA.ok && okA.firstApproval);
    const hijack = await approvePairingForUser(B.userId, p1.code);
    record("church B user cannot re-point A's approval", !hijack.ok && /already approved/i.test(hijack.error), JSON.stringify(hijack));
    record("B lookup of A-claimed code refused", !(await lookupPairingRequest(B.userId, p1.code)).ok);
    const idem = await approvePairingForUser(A.userId, p1.code);
    record("same-user re-approval is idempotent (not a second approval)", idem.ok && !idem.firstApproval);

    // 5. ticket for a different code gets nothing
    const other = await start();
    record("ticket for code Y does not receive approval for code X", (await pollPairing(other.ticket)).status === "pending");

    // 6. approved → token for A only, single-use
    const r2 = await pollPairing(p1.ticket);
    const tok = r2.status === "approved" ? r2.token : "";
    record("approved poll yields device_link token", r2.status === "approved");
    const again = await pollPairing(p1.ticket);
    record("approval is single-use (second poll → invalid, not endless pending)", again.status === "invalid", JSON.stringify(again));
    const reAfter = await approvePairingForUser(A.userId, p1.code);
    record("re-approve after desktop consumed → refused", !reAfter.ok, JSON.stringify(reAfter));
    const otherAfter = await approvePairingForUser(B.userId, p1.code);
    record("other user approve after consumed → refused", !otherAfter.ok);
    record("peek resolves token to approving user (A), not B", (await peekAuthTokenUser(tok, "device_link")) === A.userId);
    const u1 = await consumeAuthToken(tok, "device_link");
    const u2 = await consumeAuthToken(tok, "device_link");
    record("exchange token single-use", u1 === A.userId && u2 === null, `${u1} / ${u2}`);

    // 9. RACE — 20 users approve the same code concurrently
    const racers = await Promise.all(Array.from({ length: 20 }, (_, i) => seed(`R${i}`)));
    const pr = await start();
    const outcomes = await Promise.all(racers.map((r) => approvePairingForUser(r.userId, pr.code)));
    const winners = outcomes.map((o, i) => (o.ok ? racers[i].userId : null)).filter(Boolean) as string[];
    const losersMsg = outcomes.filter((o) => !o.ok).every((o) => !o.ok && /already approved/i.test(o.error));
    record("race: exactly one of 20 concurrent approvals succeeds", winners.length === 1, `winners=${winners.length}`);
    record("race: all losers told 'already approved'", losersMsg);
    const rp = await pollPairing(pr.ticket);
    const raceUser = rp.status === "approved" ? await consumeAuthToken(rp.token, "device_link") : null;
    record("race: desktop signs in as the winning user", raceUser !== null && raceUser === winners[0], `${raceUser} vs ${winners[0]}`);
    // concurrent polls on one approval → one token
    const pr2 = await start();
    await approvePairingForUser(A.userId, pr2.code);
    const polls = await Promise.all(Array.from({ length: 10 }, () => pollPairing(pr2.ticket)));
    record("concurrent polls: exactly one approved", polls.filter((p) => p.status === "approved").length === 1);

    // 3. expired / forged
    const expired = signPairTicket(generatePairCode(), Date.now() - PAIR_TTL_MS - 5000);
    record("expired ticket rejected", (await pollPairing(expired.ticket)).status === "invalid");
    const p3 = await start();
    await approvePairingForUser(A.userId, p3.code);
    const forged = p3.ticket.split(".")[0] + ".AAAA";
    record("forged-signature ticket rejected", (await pollPairing(forged)).status === "invalid");
    record("garbage/non-string ticket rejected", (await pollPairing({ x: 1 })).status === "invalid");
    record("invalid code format refused on approve", !(await approvePairingForUser(A.userId, "'; drop table--")).ok);
    record("unknown code refused on approve", !(await approvePairingForUser(A.userId, generatePairCode())).ok);

    // 7a. sign-out-all revocation (p3 approved but never polled)
    const link = await issueAuthToken(A.userId, "device_link", 20 * 60 * 1000);
    const svBefore = await sessionVersionOf(A.userId);
    await revokeAllSessionsForUser(A.userId);
    const svAfter = await sessionVersionOf(A.userId);
    record("sign-out-all bumps session_version", svAfter === svBefore + 1, `${svBefore}→${svAfter}`);
    record("sign-out-all: old JWT (sv before) verdict revoked", sessionTokenVerdict({ authTime: Date.now(), tokenVersion: svBefore, dbVersion: svAfter }) === "revoked");
    record("sign-out-all: new JWT (sv after) verdict ok", sessionTokenVerdict({ authTime: Date.now(), tokenVersion: svAfter, dbVersion: svAfter }) === "ok");
    record("sign-out-all revokes outstanding device_link", (await consumeAuthToken(link, "device_link")) === null);
    const p3poll = await pollPairing(p3.ticket);
    record("sign-out-all revokes approved-but-unconsumed pairing", p3poll.status !== "approved", JSON.stringify(p3poll));

    // 7b. password reset revocation via the real resetPassword action
    const resetTok = await issueAuthToken(B.userId, "password_reset", 60 * 60 * 1000);
    const bLink = await issueAuthToken(B.userId, "device_link", 20 * 60 * 1000);
    const p4 = await start();
    await approvePairingForUser(B.userId, p4.code);
    const bSv = await sessionVersionOf(B.userId);
    const reset = await resetPassword(resetTok, "correct-horse-battery-staple");
    record("resetPassword succeeds", reset.ok, JSON.stringify(reset));
    const bSvAfter = await sessionVersionOf(B.userId);
    record("password reset bumps session_version (old sessions end)", bSvAfter === bSv + 1 && sessionTokenVerdict({ tokenVersion: bSv, dbVersion: bSvAfter }) === "revoked");
    record("password reset revokes device_link", (await consumeAuthToken(bLink, "device_link")) === null);
    record("password reset revokes pending pairing", (await pollPairing(p4.ticket)).status !== "approved");

    // 13. reset-vs-poll race
    let survived = 0;
    const RUNS = 200;
    for (let i = 0; i < RUNS; i++) {
      const p = await start();
      await approvePairingForUser(A.userId, p.code);
      const [pr] = await Promise.all([
        pollPairing(p.ticket),
        new Promise((r) => setTimeout(r, Math.random() * 6)).then(() => revokeAllSessionsForUser(A.userId)),
      ]);
      if (pr.status === "approved" && (await consumeAuthToken(pr.token, "device_link"))) survived++;
    }
    record("RACE: no exchange token survives a concurrent reset", survived === 0, `${survived}/${RUNS}`);

    // 14. poll on revoked row → expired (not pending)
    const p5 = await start();
    await approvePairingForUser(A.userId, p5.code);
    await revokeAllSessionsForUser(A.userId);
    const p5poll = await pollPairing(p5.ticket);
    record("poll after revocation → expired", p5poll.status === "expired", JSON.stringify(p5poll));
    const p6 = await start();
    await getDb().update(devicePairRequests).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(devicePairRequests.codeHash, pairCodeHash(p6.code)));
    const p6poll = await pollPairing(p6.ticket);
    record("poll on expired unapproved row → expired", p6poll.status === "expired", JSON.stringify(p6poll));

    // 12. absolute cap
    record("180-day cap: session older than cap → expired", sessionTokenVerdict({ authTime: Date.now() - SESSION_ABSOLUTE_MAX_MS - 1000, tokenVersion: 0, dbVersion: 0 }) === "expired");
    record("180-day cap: 179-day-old session still ok", sessionTokenVerdict({ authTime: Date.now() - 179 * 86400000, tokenVersion: 0, dbVersion: 0 }) === "ok");

    // 8. swap confirmation + no-session deep link
    const attackerTok = await issueAuthToken(B.userId, "device_link", 20 * 60 * 1000);
    const tokUser = await peekAuthTokenUser(attackerTok, "device_link");
    record("attacker token vs signed-in victim → confirm (never silent)", decideExchange(A.userId, tokUser) === "confirm");
    record("attacker deep link with NO session → confirm-signin (login CSRF)", decideExchange(null, tokUser) === "confirm-signin");
    record("no session + valid pairing marker → exchange", decideExchange(null, tokUser, { pairMarkerValid: true }) === "exchange");
    record("peek does not consume (token still valid until confirmed POST)", (await peekAuthTokenUser(attackerTok, "device_link")) === B.userId);
    const expiredLink = await issueAuthToken(B.userId, "device_link", -1000);
    record("expired device_link → invalid decision", decideExchange(A.userId, await peekAuthTokenUser(expiredLink, "device_link")) === "invalid");
    record("unknown token → invalid", decideExchange(null, await peekAuthTokenUser(mintToken().plaintext, "device_link")) === "invalid");
  } finally {
    const db = getDb();
    if (codeHashes.length) await db.delete(devicePairRequests).where(inArray(devicePairRequests.codeHash, codeHashes));
    const ids = seeded.map((s) => s.userId);
    await db.delete(devicePairRequests).where(inArray(devicePairRequests.claimedByUserId, ids));
    await db.delete(authTokens).where(inArray(authTokens.userId, ids));
    await db.delete(users).where(inArray(users.id, ids));
    await db.delete(churches).where(inArray(churches.id, seeded.map((s) => s.churchId)));
  }
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
