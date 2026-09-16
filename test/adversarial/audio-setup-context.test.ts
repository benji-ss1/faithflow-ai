// Adversarial cross-church test — Sarah audio setup (CLAUDE.md rule 5).
//
// beta_applications is a PLATFORM-level table (not church-scoped), so the setup
// context is the one place a church could see another church's data. This seeds two
// ephemeral churches in the LOCAL DB and drives the REAL church-scoped core
// (src/lib/server/audio-setup.ts) as Church B against Church A's application + profile.
//
// RUN
//   npx tsx --env-file=.env.local test/adversarial/audio-setup-context.test.ts
//
// Refuses to run against a non-localhost DATABASE_URL.

import { eq, inArray } from "drizzle-orm";
import { getDb } from "../../src/lib/db/client";
import { betaApplications, churchAudioProfiles, churches, users } from "../../src/lib/db/schema";
import { loadSetupContextCore, saveAudioProfileCore } from "../../src/lib/server/audio-setup";

function isLocalDbUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (!["localhost", "127.0.0.1"].includes(u.hostname)) return false;
  for (const k of u.searchParams.keys()) if (k.toLowerCase() === "host" || k.toLowerCase() === "hostaddr") return false;
  return true;
}
if (!isLocalDbUrl(process.env.DATABASE_URL ?? "")) {
  console.error("REFUSING: DATABASE_URL is not a localhost database.");
  process.exit(2);
}

const results: { name: string; pass: boolean; detail: string }[] = [];
function record(name: string, pass: boolean, detail = "") {
  results.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

const SUFFIX = `adv-${Date.now()}`;
const db = getDb();
const ids = { churchA: "", churchB: "", userA: "", userB: "", appA: "" };

async function seed() {
  const [a] = await db.insert(churches).values({ name: `Grace Chapel Lagos ${SUFFIX}`, city: "Lagos", country: "Nigeria" }).returning({ id: churches.id });
  const [b] = await db.insert(churches).values({ name: `Grace ${SUFFIX}`, city: "London", country: "United Kingdom" }).returning({ id: churches.id });
  ids.churchA = a.id; ids.churchB = b.id;
  const [ua] = await db.insert(users).values({
    churchId: a.id, email: `tech-${SUFFIX}@gracechapel.example`, passwordHash: "x", name: "Tech A", role: "operator", emailVerifiedAt: new Date(),
  }).returning({ id: users.id });
  const [ub] = await db.insert(users).values({
    churchId: b.id, email: `attacker-${SUFFIX}@gmail.com`, passwordHash: "x", name: "Other B", role: "admin", emailVerifiedAt: new Date(),
  }).returning({ id: users.id });
  ids.userA = ua.id; ids.userB = ub.id;
  const [app] = await db.insert(betaApplications).values({
    churchName: `Grace Chapel Lagos ${SUFFIX}`,
    contactEmail: `pastor-${SUFFIX}@gracechapel.example`,
    answers: [
      { question: "What's your church called, and where?", answer: `Church name: Grace Chapel Lagos ${SUFFIX} · City: Lagos · Country: Nigeria` },
      { question: "What soundboard / mixer does your church use?", answer: "Behringer X32 SECRET" },
      { question: "What device runs your presentations?", answer: "Mac" },
      { question: "What's your name?", answer: "First name: Samuel · Last name: PrivateSurname" },
    ],
    ip: "203.0.113.9", userAgent: "seed",
  }).returning({ id: betaApplications.id });
  ids.appA = app.id;
}

async function cleanup() {
  await db.delete(churchAudioProfiles).where(inArray(churchAudioProfiles.churchId, [ids.churchA, ids.churchB].filter(Boolean)));
  await db.delete(users).where(inArray(users.id, [ids.userA, ids.userB].filter(Boolean)));
  if (ids.appA) await db.delete(betaApplications).where(eq(betaApplications.id, ids.appA));
  await db.delete(churches).where(inArray(churches.id, [ids.churchA, ids.churchB].filter(Boolean)));
}

async function main() {
  await seed();
  const userA = { id: ids.userA, email: `tech-${SUFFIX}@gracechapel.example`, name: "Tech A", churchId: ids.churchA };
  const userB = { id: ids.userB, email: `attacker-${SUFFIX}@gmail.com`, name: "Other B", churchId: ids.churchB };

  // 1. Church A (same email domain as the applicant) gets the full application.
  const ctxA = await loadSetupContextCore(db, userA);
  record("own application matches with identity", ctxA.match?.identityMatched === true, `confidence=${ctxA.match?.confidence}`);
  record("own application releases setup", ctxA.match?.setup.desk === "Behringer X32 SECRET");

  // 2. Church B shares a guessable name word ("Grace") but no identity signal.
  const ctxB = await loadSetupContextCore(db, userB);
  const leakedDesk = ctxB.match?.setup.desk;
  const leakedName = ctxB.match?.setup.applicantName;
  const leakedCity = ctxB.match?.setup.city;
  record("other church never gets an identity match", ctxB.match?.identityMatched !== true, `confidence=${ctxB.match?.confidence ?? "none"}`);
  record("other church cannot read the desk", leakedDesk === undefined, `desk=${leakedDesk ?? "-"}`);
  record("other church cannot read the applicant name", leakedName === undefined, `name=${leakedName ?? "-"}`);
  record("other church cannot read the city", leakedCity === undefined, `city=${leakedCity ?? "-"}`);
  record("other church never reaches 'high'", ctxB.match?.confidence !== "high");

  // 3. Church B cannot attach itself to Church A's application.
  await saveAudioProfileCore(db, userB, { desk: "B desk", connection: "ndi" }, ids.appA);
  const [rowB] = await db.select().from(churchAudioProfiles).where(eq(churchAudioProfiles.churchId, ids.churchB)).limit(1);
  record("confirmedApplicationId from another church is refused", rowB?.confirmedApplicationId === null, `stored=${rowB?.confirmedApplicationId ?? "null"}`);

  // 4. Profiles are church-scoped: B's write never touches A's row, and A sees only its own.
  await saveAudioProfileCore(db, userA, { desk: "A desk", connection: "usb-desk" }, ids.appA);
  const ctxA2 = await loadSetupContextCore(db, userA);
  const ctxB2 = await loadSetupContextCore(db, userB);
  record("church A reads its own profile", ctxA2.profile.desk === "A desk");
  record("church B reads its own profile", ctxB2.profile.desk === "B desk");
  const [rowA] = await db.select().from(churchAudioProfiles).where(eq(churchAudioProfiles.churchId, ids.churchA)).limit(1);
  record("church A's own application id IS stored", rowA?.confirmedApplicationId === ids.appA);

  // 5. Unverified members must not unlock an application.
  await db.insert(users).values({
    churchId: ids.churchB, email: `pastor-${SUFFIX}@gracechapel.example`, passwordHash: "x", name: "Invited", role: "viewer", emailVerifiedAt: null,
  });
  const ctxB3 = await loadSetupContextCore(db, userB);
  record("unverified invited member does not unlock the application", ctxB3.match?.identityMatched !== true, `confidence=${ctxB3.match?.confidence ?? "none"}`);
  await db.delete(users).where(eq(users.email, `pastor-${SUFFIX}@gracechapel.example`));
}

main()
  .then(async () => {
    await cleanup();
    const failedCount = results.filter((r) => !r.pass).length;
    console.log(`\naudio-setup-context (adversarial): ${results.length - failedCount} passed, ${failedCount} failed`);
    process.exit(failedCount > 0 ? 1 : 0);
  })
  .catch(async (e) => {
    console.error(e);
    await cleanup().catch(() => {});
    process.exit(1);
  });
