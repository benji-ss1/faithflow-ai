// Adversarial tests for desktop auto sign-in (pairing + device-link).
//
// RUN
//   npx tsx --env-file=.env.local test/adversarial/desktop-signin.test.ts
//
// Proves:
//   1. An unapproved pairing code can't be exchanged (poll stays pending).
//   2. Approval is single-use: second poll after approval gets nothing.
//   3. Expired tickets rejected; forged tickets (other code hash) rejected.
//   4. Cross-church: church B's user cannot re-point church A's pending
//      approval; approval resolves ONLY to the approving user.
//   5. A ticket for code X never receives an approval made for code Y.
//   6. Device-link tokens from pairing are single-use + resolve to the approver.
//   7. Password reset revokes outstanding device_link / device_pair tokens.
//   8. Account swap: attacker's token for a DIFFERENT user is classified
//      "confirm" (never silent exchange) and peek does NOT consume it.

import { eq, inArray } from "drizzle-orm";
import { getDb } from "../../src/lib/db/client";
import { churches, users, authTokens } from "../../src/lib/db/schema";
import { consumeAuthToken, issueAuthToken, peekAuthTokenUser, invalidateUserTokens } from "../../src/lib/auth-tokens";
import { approvePairingForUser, pollPairing, startPairing } from "../../src/lib/desktop-pair";
import { decideExchange, signPairTicket, generatePairCode, PAIR_TTL_MS } from "../../src/lib/desktop-auth-core";

type Attempt = { name: string; pass: boolean; detail: string };
const results: Attempt[] = [];
function record(name: string, pass: boolean, detail = "") {
  results.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

async function seed(label: string) {
  const db = getDb();
  const [ch] = await db.insert(churches).values({ name: `Adversarial ${label}`, timezone: "UTC" }).returning();
  const [u] = await db.insert(users).values({
    churchId: ch.id,
    email: `desktop-signin-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.invalid`,
    passwordHash: "not-a-real-hash",
    name: `Desktop ${label}`,
  }).returning();
  return { churchId: ch.id, userId: u.id };
}

async function main() {
  const A = await seed("A");
  const B = await seed("B");
  try {
    // 1. unapproved
    const p1 = startPairing();
    const r1 = await pollPairing(p1.ticket);
    record("unapproved code stays pending (no token)", r1.status === "pending", JSON.stringify(r1));

    // 4. cross-church re-point + approval binding
    const okA = await approvePairingForUser(A.userId, p1.displayCode);
    record("church A user approves own code", okA.ok);
    const hijack = await approvePairingForUser(B.userId, p1.code);
    record("church B user cannot re-point A's pending approval", !hijack.ok, JSON.stringify(hijack));
    const idem = await approvePairingForUser(A.userId, p1.code);
    record("same-user re-approval is idempotent", idem.ok);

    // 5. ticket for a different code gets nothing
    const other = startPairing();
    const rOther = await pollPairing(other.ticket);
    record("ticket for code Y does not receive approval for code X", rOther.status === "pending");

    // 6. approved → token for A only, single-use approval
    const r2 = await pollPairing(p1.ticket);
    const tok = r2.status === "approved" ? r2.token : "";
    record("approved poll yields device_link token", r2.status === "approved");
    const again = await pollPairing(p1.ticket);
    record("approval is single-use (second poll pending)", again.status === "pending", JSON.stringify(again));
    record("peek resolves token to approving user (A), not B", (await peekAuthTokenUser(tok, "device_link")) === A.userId);
    const u1 = await consumeAuthToken(tok, "device_link");
    const u2 = await consumeAuthToken(tok, "device_link");
    record("exchange token single-use", u1 === A.userId && u2 === null, `${u1} / ${u2}`);
    record("pair approval row not consumable as device_link", (await consumeAuthToken(p1.code, "device_link")) === null);

    // 3. expired / forged
    const expired = signPairTicket(generatePairCode(), Date.now() - PAIR_TTL_MS - 5000);
    record("expired ticket rejected", (await pollPairing(expired.ticket)).status === "invalid");
    const p3 = startPairing();
    await approvePairingForUser(A.userId, p3.code);
    const forged = p3.ticket.split(".")[0] + ".AAAA";
    record("forged-signature ticket rejected", (await pollPairing(forged)).status === "invalid");
    record("garbage/non-string ticket rejected", (await pollPairing({ x: 1 })).status === "invalid");
    record("invalid code format refused on approve", !(await approvePairingForUser(A.userId, "'; drop table--")).ok);

    // 7. password reset revocation (p3 approved but never polled)
    const link = await issueAuthToken(A.userId, "device_link", 20 * 60 * 1000);
    await invalidateUserTokens(A.userId, ["device_link", "device_pair"]);
    record("password reset revokes outstanding device_link", (await consumeAuthToken(link, "device_link")) === null);
    record("password reset revokes pending pair approval", (await pollPairing(p3.ticket)).status === "pending");

    // 8. swap confirmation
    const attackerTok = await issueAuthToken(B.userId, "device_link", 20 * 60 * 1000);
    const tokUser = await peekAuthTokenUser(attackerTok, "device_link");
    record("attacker token vs signed-in victim → confirm (never silent)", decideExchange(A.userId, tokUser) === "confirm");
    record("peek does not consume (token still valid until confirmed POST)", (await peekAuthTokenUser(attackerTok, "device_link")) === B.userId);
    const expiredLink = await issueAuthToken(B.userId, "device_link", -1000);
    record("expired device_link → invalid decision", decideExchange(A.userId, await peekAuthTokenUser(expiredLink, "device_link")) === "invalid");
  } finally {
    const db = getDb();
    await db.delete(authTokens).where(inArray(authTokens.userId, [A.userId, B.userId]));
    for (const s of [A, B]) {
      await db.delete(users).where(eq(users.id, s.userId));
      await db.delete(churches).where(eq(churches.id, s.churchId));
    }
  }
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
