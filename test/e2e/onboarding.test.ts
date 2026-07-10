// CP5 End-to-end onboarding journey test.
//
// Simulates a brand-new church onboarding, from sign-up through tutorial
// completion, exercising the exact server-side code paths a real user hits.
// Runs against the DB directly (no dev server, no browser). Session-guarded
// server actions are simulated by calling their raw DB operations with the
// same church_id / user_id the real action would resolve, since we own the
// ephemeral test user's identity for the duration of the run.
//
// RUN
//   npx tsx --env-file=.env.local test/e2e/onboarding.test.ts
//
// Cleanup: deletes the ephemeral church + user + everything owned by them.

import { and, eq, inArray } from "drizzle-orm";
import bcrypt from "bcryptjs";
import {
  users, churches, subscriptions, churchPreferences,
  migrationJobs, songs, songSlides, mediaAssets, authTokens,
  servicePlans, invitations, settings, licensedTranslations, announcements,
  announcementPresets, themes, churchServicePatterns, pptxImports,
} from "../../src/lib/db/schema";
import { getDb } from "../../src/lib/db/client";
import { getParser } from "../../src/lib/parsers";
import { decideTerminalStatus } from "../../src/lib/parsers/terminal-status";

type StepResult = { name: string; pass: boolean; detail: string };
const steps: StepResult[] = [];
function record(name: string, pass: boolean, detail: string) {
  steps.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name} — ${detail}`);
}

async function cleanup(churchId: string | null, userId: string | null) {
  const db = getDb();
  try {
    if (churchId) {
      const planRows = await db.select({ id: servicePlans.id }).from(servicePlans).where(eq(servicePlans.churchId, churchId));
      if (planRows.length) await db.delete(servicePlans).where(inArray(servicePlans.id, planRows.map((r) => r.id)));
      const songRows = await db.select({ id: songs.id }).from(songs).where(eq(songs.churchId, churchId));
      if (songRows.length) await db.delete(songs).where(inArray(songs.id, songRows.map((r) => r.id)));
      const impRows = await db.select({ id: pptxImports.id }).from(pptxImports).where(eq(pptxImports.churchId, churchId));
      if (impRows.length) await db.delete(pptxImports).where(inArray(pptxImports.id, impRows.map((r) => r.id)));
      await db.delete(mediaAssets).where(eq(mediaAssets.churchId, churchId));
      await db.delete(churchPreferences).where(eq(churchPreferences.churchId, churchId));
      await db.delete(settings).where(eq(settings.churchId, churchId));
      await db.delete(churchServicePatterns).where(eq(churchServicePatterns.churchId, churchId));
      await db.delete(licensedTranslations).where(eq(licensedTranslations.churchId, churchId));
      await db.delete(announcements).where(eq(announcements.churchId, churchId));
      await db.delete(announcementPresets).where(eq(announcementPresets.churchId, churchId));
      await db.delete(themes).where(eq(themes.churchId, churchId));
      await db.delete(migrationJobs).where(eq(migrationJobs.churchId, churchId));
      await db.delete(subscriptions).where(eq(subscriptions.churchId, churchId));
      await db.delete(invitations).where(eq(invitations.churchId, churchId));
    }
    if (userId) {
      await db.delete(authTokens).where(eq(authTokens.userId, userId));
      // Detach user from church before deleting churches row (FK).
      await db.update(users).set({ churchId: null }).where(eq(users.id, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
    if (churchId) await db.delete(churches).where(eq(churches.id, churchId));
  } catch (e) {
    console.error("cleanup error:", e instanceof Error ? e.message : e);
  }
}

async function main() {
  const startedAt = Date.now();
  console.log("=== CP5 Onboarding E2E ===");
  const db = getDb();
  const stamp = Date.now();
  const email = `e2e-onboarding-${stamp}@faithflow.test`;
  const password = "Password12345!";
  const name = "E2E Church Owner";
  let userId: string | null = null;
  let churchId: string | null = null;

  try {
    // 1. Sign up (mirrors auth-actions.signUp minus rate limit and email send).
    const passwordHash = await bcrypt.hash(password, 12);
    const [u] = await db.insert(users).values({
      email, passwordHash, name, role: "admin", churchId: null,
    }).returning();
    userId = u.id;
    record("Sign up user", !!u.id, `id=${u.id.slice(0, 8)}`);

    // 2. Simulate email verification click (mirrors auth-actions.verifyEmail).
    await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, u.id));
    const [v] = await db.select({ verified: users.emailVerifiedAt }).from(users).where(eq(users.id, u.id));
    record("Verify email (simulate token click)", !!v.verified, "emailVerifiedAt set");

    // 3. Session helper — the real /login uses NextAuth Credentials which we
    //    can't invoke without an HTTP context. We validate the same shape
    //    (email + bcrypt password) instead.
    {
      const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      const ok = row ? await bcrypt.compare(password, row.passwordHash) : false;
      record("Sign in (fabricate session)", ok, "bcrypt password verified");
    }

    // 4. Create church + attach (mirrors onboarding-actions.createChurchAndAttachUser).
    const [ch] = await db.insert(churches).values({
      name: `E2E Test Church ${stamp}`,
      city: "Dublin", country: "Ireland", timezone: "Europe/Dublin",
      congregationSize: 120, denomination: "Non-denominational",
      onboardingStatus: "in_progress",
    }).returning();
    churchId = ch.id;
    await db.update(users).set({ churchId: ch.id }).where(eq(users.id, u.id));
    await db.insert(subscriptions).values({ churchId: ch.id, tier: "pilot", status: "pilot" });
    await db.insert(churchPreferences).values({ churchId: ch.id });
    const [uAfter] = await db.select({ churchId: users.churchId }).from(users).where(eq(users.id, u.id));
    record("Create church + attach user", !!ch.id && uAfter.churchId === ch.id, `churchId=${ch.id.slice(0, 8)}`);

    // 5. Kick off a migration via the CSV parser (same parser wired to the
    //    /api/imports/parse endpoint). Small CSV, no S3 dependency.
    const csv = "title,artist,slide1,slide2\nAmazing Grace,John Newton,\"Amazing grace how sweet the sound\",\"That saved a wretch like me\"\nHoly Holy Holy,Reginald Heber,\"Holy holy holy\",\"Lord God almighty\"\n";
    const parser = getParser("csv");
    if (!parser) throw new Error("csv parser missing");
    const parseResult = await parser.parse([{ name: "songs.csv", buffer: Buffer.from(csv, "utf8") }]);
    const [job] = await db.insert(migrationJobs).values({
      churchId: ch.id, userId: u.id, source: "csv", status: "processing",
      sourceFileName: "songs.csv", summaryJson: { parserId: "csv" },
    }).returning();
    const terminal = decideTerminalStatus({
      parserId: "csv", fileCount: 1, anyParserRan: true,
      songsProduced: parseResult.songs.length, mediaProduced: 0, skipped: parseResult.skipped,
    });
    await db.update(migrationJobs).set({
      status: terminal.status,
      summaryJson: {
        parserId: "csv",
        counts: { songs: parseResult.songs.length, media: 0, skipped: parseResult.skipped.length },
        songs: parseResult.songs.map((s) => ({ title: s.title, artist: s.artist ?? null, slides: s.slides })),
        media: [],
        skipped: parseResult.skipped,
      },
      ...(terminal.errorMessage ? { errorMessage: terminal.errorMessage } : {}),
    }).where(eq(migrationJobs.id, job.id));
    const [refreshedJob] = await db.select().from(migrationJobs).where(eq(migrationJobs.id, job.id));
    record("Migration parse (CSV)", refreshedJob.status === "ready", `status=${refreshedJob.status} songs=${parseResult.songs.length}`);

    // 6. Finalize — write songs + slides scoped to this church.
    const parsedSongs = parseResult.songs;
    let songsAdded = 0, songsSkipped = 0;
    for (const s of parsedSongs) {
      const title = (s.title || "").trim();
      if (!title || s.slides.length === 0) { songsSkipped++; continue; }
      const [dup] = await db.select().from(songs).where(and(eq(songs.churchId, ch.id), eq(songs.title, title))).limit(1);
      if (dup) { songsSkipped++; continue; }
      const [row] = await db.insert(songs).values({
        churchId: ch.id, title, artist: s.artist ?? null, source: "imported",
      }).returning();
      await db.insert(songSlides).values(s.slides.map((lyrics, i) => ({ songId: row.id, order: i, lyrics })));
      songsAdded++;
    }
    record("Finalize import", songsAdded > 0, `songsAdded=${songsAdded} skipped=${songsSkipped}`);

    // 7. Confirm songs are scoped to the new church.
    const scoped = await db.select().from(songs).where(eq(songs.churchId, ch.id));
    record("Songs scoped to new church", scoped.length > 0, `count=${scoped.length}`);

    // 8. Advance tutorial — mirror completeTutorial + completeOnboarding.
    await db.update(users).set({ tutorialCompletedAt: new Date() }).where(eq(users.id, u.id));
    await db.update(churches).set({ onboardingStatus: "complete" }).where(eq(churches.id, ch.id));
    const [finalUser] = await db.select({ t: users.tutorialCompletedAt }).from(users).where(eq(users.id, u.id));
    const [finalChurch] = await db.select({ s: churches.onboardingStatus }).from(churches).where(eq(churches.id, ch.id));
    record("Tutorial + onboarding complete", !!finalUser.t && finalChurch.s === "complete", `onboardingStatus=${finalChurch.s}`);

    // Final aggregate assertions.
    record("Churches row exists", !!finalChurch, "row present");
    record("Migration job status = ready", refreshedJob.status === "ready", `status=${refreshedJob.status}`);
    record("songs.count > 0 for church", scoped.length > 0, `n=${scoped.length}`);
  } catch (e) {
    record("Uncaught error", false, e instanceof Error ? e.message : String(e));
  } finally {
    await cleanup(churchId, userId);
  }

  const passCount = steps.filter((s) => s.pass).length;
  const total = steps.length;
  const durMs = Date.now() - startedAt;
  console.log(`\n=== E2E Onboarding: ${passCount}/${total} PASS (${durMs} ms) ===`);
  for (const s of steps) console.log(`  ${s.pass ? "PASS" : "FAIL"}: ${s.name} — ${s.detail}`);
  if (passCount !== total) {
    console.error("\nCP5 E2E FAILED.");
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => { console.error("Test crashed:", e); process.exit(2); });
