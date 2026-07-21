// Adversarial test for the desktop-app auto-login device-link token path.
//
// PURPOSE
//   Prove that the device_link token kind (src/lib/auth-tokens.ts, reused
//   by src/lib/device-link-actions.ts + the "device-token" NextAuth
//   provider in src/lib/auth.ts) behaves like a real one-time credential:
//     1. Happy path: mint → consume returns the correct userId.
//     2. Single-use: a second consume attempt with the same plaintext fails.
//     3. Expiry: an already-expired token cannot be consumed.
//     4. Kind isolation: a token minted as "verify_email" or
//        "password_reset" cannot be consumed as "device_link", and vice
//        versa — the three kinds must not bleed into each other even
//        though they share one table.
//
// RUN
//   npx tsx --env-file=.env.local test/adversarial/device-link-token.test.ts

import { eq } from "drizzle-orm";
import { getDb } from "../../src/lib/db/client";
import { churches, users, authTokens } from "../../src/lib/db/schema";
import { issueAuthToken, consumeAuthToken } from "../../src/lib/auth-tokens";

type Attempt = { name: string; pass: boolean; detail: string };
const results: Attempt[] = [];
function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name} — ${detail}`);
}

async function seedUser() {
  const db = getDb();
  const [ch] = await db.insert(churches).values({ name: "Adversarial Test Church", timezone: "UTC" }).returning();
  const [u] = await db.insert(users).values({
    churchId: ch.id,
    email: `device-link-test-${Date.now()}@example.invalid`,
    passwordHash: "not-a-real-hash",
    name: "Device Link Test User",
  }).returning();
  return { churchId: ch.id, userId: u.id };
}

async function cleanup(churchId: string, userId: string) {
  const db = getDb();
  await db.delete(authTokens).where(eq(authTokens.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(churches).where(eq(churches.id, churchId));
}

async function main() {
  const { churchId, userId } = await seedUser();
  try {
    // 1. Happy path
    const t1 = await issueAuthToken(userId, "device_link", 5 * 60 * 1000);
    const resolved = await consumeAuthToken(t1, "device_link");
    record("happy path resolves correct user", resolved === userId, `expected ${userId}, got ${resolved}`);

    // 2. Single-use — same token, second attempt must fail
    const second = await consumeAuthToken(t1, "device_link");
    record("single-use enforced", second === null, `expected null on reuse, got ${second}`);

    // 3. Expiry — TTL of -1ms means it's already expired at issue time
    const expired = await issueAuthToken(userId, "device_link", -1000);
    const expiredResult = await consumeAuthToken(expired, "device_link");
    record("expired token rejected", expiredResult === null, `expected null for expired token, got ${expiredResult}`);

    // 4a. A verify_email token must not be consumable as device_link
    const verifyTok = await issueAuthToken(userId, "verify_email", 5 * 60 * 1000);
    const crossA = await consumeAuthToken(verifyTok, "device_link");
    record("verify_email token rejected as device_link", crossA === null, `expected null, got ${crossA}`);
    // ...and must still work correctly under its own real kind
    const verifyOk = await consumeAuthToken(verifyTok, "verify_email");
    record("verify_email token still valid under correct kind", verifyOk === userId, `expected ${userId}, got ${verifyOk}`);

    // 4b. A device_link token must not be consumable as password_reset
    const linkTok = await issueAuthToken(userId, "device_link", 5 * 60 * 1000);
    const crossB = await consumeAuthToken(linkTok, "password_reset");
    record("device_link token rejected as password_reset", crossB === null, `expected null, got ${crossB}`);
    const linkOk = await consumeAuthToken(linkTok, "device_link");
    record("device_link token still valid under correct kind", linkOk === userId, `expected ${userId}, got ${linkOk}`);
  } finally {
    await cleanup(churchId, userId);
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  if (failed.length > 0) {
    console.error(`${failed.length} FAILED`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test crashed:", err);
  process.exit(1);
});
