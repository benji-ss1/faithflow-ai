/**
 * Realistic demo church for external review (Victor at JPD).
 *
 * Creates: JPD Demo Church + 1 operator + 4 seeded songs + 1 realistic
 * service plan with 6 items covering every content type + 5 resolved
 * autopilot history entries so the analytics dashboard has real data.
 *
 * Idempotent: safe to re-run — will DELETE the demo church and everything
 * cascade-owned before re-seeding, keyed by unique email.
 *
 * Run: npx tsx --env-file=.env.local scripts/seed-demo.ts
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { getDb } from "../src/lib/db/client";
import {
  churches, users, songs, songSlides, servicePlans, serviceItems, settings,
  aiSuggestions, churchPreferences,
} from "../src/lib/db/schema";

const DEMO_EMAIL = "demo@jpd.faithflow.ai";
const DEMO_PASSWORD = "JpdReview2026!";
const DEMO_CHURCH_NAME = "JPD Demo Church";

async function main() {
  const db = getDb();

  // ---- Idempotency: nuke existing demo church + user ----
  const [existingUser] = await db.select().from(users).where(eq(users.email, DEMO_EMAIL)).limit(1);
  if (existingUser?.churchId) {
    console.log("Cleaning up previous demo church…");
    await db.delete(churches).where(eq(churches.id, existingUser.churchId));
    // cascade removes settings/prefs/plans/items/songs/slides/suggestions
  }
  if (existingUser) await db.delete(users).where(eq(users.email, DEMO_EMAIL));

  // ---- Fresh church ----
  const [church] = await db.insert(churches).values({
    name: DEMO_CHURCH_NAME,
    city: "London",
    country: "GB",
    timezone: "Europe/London",
    congregationSize: 220,
    denomination: "Non-denominational",
    onboardingStatus: "complete",
  }).returning();
  await db.insert(settings).values({ churchId: church.id });
  await db.insert(churchPreferences).values({
    churchId: church.id,
    aiListeningDefault: true,
    autoApproveEnabled: false,
    detectionConfidenceThreshold: 60,
  });

  // ---- Demo user ----
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const [user] = await db.insert(users).values({
    churchId: church.id,
    email: DEMO_EMAIL,
    passwordHash,
    name: "Victor (JPD Review)",
    role: "admin",
    emailVerifiedAt: new Date(),
    tutorialCompletedAt: new Date(),
  }).returning();

  // ---- 4 songs (all public-domain or original placeholder lyrics) ----
  const songData = [
    { title: "Amazing Grace", artist: "John Newton", slides: [
      "Amazing grace, how sweet the sound\nThat saved a wretch like me\nI once was lost, but now am found\nWas blind, but now I see",
      "'Twas grace that taught my heart to fear\nAnd grace my fears relieved\nHow precious did that grace appear\nThe hour I first believed",
      "Through many dangers, toils and snares\nI have already come\n'Tis grace hath brought me safe thus far\nAnd grace will lead me home",
      "When we've been there ten thousand years\nBright shining as the sun\nWe've no less days to sing God's praise\nThan when we'd first begun",
    ]},
    { title: "How Great Thou Art", artist: "Stuart K. Hine (public domain arrangement)", slides: [
      "O Lord my God, when I in awesome wonder\nConsider all the works Thy hands have made\nI see the stars, I hear the rolling thunder\nThy power throughout the universe displayed",
      "Then sings my soul, my Saviour God, to Thee\nHow great Thou art, how great Thou art\nThen sings my soul, my Saviour God, to Thee\nHow great Thou art, how great Thou art",
    ]},
    { title: "Holy, Holy, Holy", artist: "Reginald Heber", slides: [
      "Holy, holy, holy! Lord God Almighty!\nEarly in the morning our song shall rise to Thee\nHoly, holy, holy, merciful and mighty!\nGod in three persons, blessed Trinity!",
      "Holy, holy, holy! all the saints adore Thee\nCasting down their golden crowns around the glassy sea\nCherubim and seraphim falling down before Thee\nWhich wert, and art, and evermore shalt be",
    ]},
    { title: "Great Is Thy Faithfulness", artist: "Thomas Chisholm", slides: [
      "Great is Thy faithfulness, O God my Father\nThere is no shadow of turning with Thee\nThou changest not, Thy compassions they fail not\nAs Thou hast been Thou forever wilt be",
      "Great is Thy faithfulness! Great is Thy faithfulness!\nMorning by morning new mercies I see\nAll I have needed Thy hand hath provided\nGreat is Thy faithfulness, Lord, unto me!",
    ]},
  ];

  const createdSongs: { id: string; title: string }[] = [];
  for (const s of songData) {
    const [row] = await db.insert(songs).values({ churchId: church.id, title: s.title, artist: s.artist, source: "public_domain" }).returning();
    await db.insert(songSlides).values(s.slides.map((lyrics, i) => ({ songId: row.id, order: i, lyrics })));
    createdSongs.push({ id: row.id, title: row.title });
  }

  // ---- Realistic service plan ----
  const [plan] = await db.insert(servicePlans).values({
    churchId: church.id,
    title: "Sunday Morning · March 15 2026",
    scheduledFor: "2026-03-15",
    notes: "Guest speaker · Pastor Nathaniel · Communion Sunday",
  }).returning();

  await db.insert(serviceItems).values([
    { servicePlanId: plan.id, order: 0, type: "logo", title: "Welcome — JPD Demo Church", payload: {} },
    { servicePlanId: plan.id, order: 1, type: "song", title: "How Great Thou Art", payload: { songId: createdSongs[1].id } },
    { servicePlanId: plan.id, order: 2, type: "song", title: "Amazing Grace", payload: { songId: createdSongs[0].id } },
    {
      servicePlanId: plan.id, order: 3, type: "scripture", title: "John 3:16-17",
      payload: {
        reference: "John 3:16-17",
        slides: [
          { text: "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life." },
          { text: "For God sent not his Son into the world to condemn the world; but that the world through him might be saved." },
        ],
      },
    },
    { servicePlanId: plan.id, order: 4, type: "blank", title: "Prayer / Communion", payload: {} },
    { servicePlanId: plan.id, order: 5, type: "song", title: "Great Is Thy Faithfulness", payload: { songId: createdSongs[3].id } },
  ]);

  // ---- 5 resolved AI suggestions so /analytics has trend data ----
  const now = Date.now();
  await db.insert(aiSuggestions).values([
    {
      servicePlanId: plan.id, type: "scripture",
      payload: { book: "John", chapter: 3, verseStart: 16, verseEnd: 16 },
      confidence: 94, status: "approved", actionTaken: "manual_approved",
      reason: "Operator approved during sermon", resolvedBy: user.id, resolvedAt: new Date(now - 6 * 3600_000),
    },
    {
      servicePlanId: plan.id, type: "song",
      payload: { title: "Amazing Grace" },
      confidence: 88, status: "approved", actionTaken: "manual_approved",
      reason: "Cue detected: 'let's sing Amazing Grace'", resolvedBy: user.id, resolvedAt: new Date(now - 5 * 3600_000),
    },
    {
      servicePlanId: plan.id, type: "scripture",
      payload: { book: "Romans", chapter: 8, verseStart: 28, verseEnd: 28 },
      confidence: 91, status: "approved", actionTaken: "manual_approved",
      reason: "Detected mid-sermon", resolvedBy: user.id, resolvedAt: new Date(now - 4 * 3600_000),
    },
    {
      servicePlanId: plan.id, type: "action",
      payload: { verb: "blank_screen" },
      confidence: 72, status: "rejected", actionTaken: "rejected",
      reason: "Operator judged unsafe to auto-execute", resolvedBy: user.id, resolvedAt: new Date(now - 3 * 3600_000),
    },
    {
      servicePlanId: plan.id, type: "scripture",
      payload: { book: "Psalms", chapter: 23, verseStart: 1, verseEnd: 6 },
      confidence: 96, status: "approved", actionTaken: "edited",
      editedPayload: { book: "Psalms", chapter: 23, verseStart: 1, verseEnd: 4 },
      reason: "Operator narrowed range before staging", resolvedBy: user.id, resolvedAt: new Date(now - 2 * 3600_000),
    },
  ]);

  console.log("\n✅ Demo church seeded\n");
  console.log(`   Email:    ${DEMO_EMAIL}`);
  console.log(`   Password: ${DEMO_PASSWORD}`);
  console.log(`   Church:   ${DEMO_CHURCH_NAME} (${church.id})`);
  console.log(`   Plan:     ${plan.title}`);
  console.log(`   Songs:    ${createdSongs.length}`);
  console.log(`   AI history rows: 5`);
  console.log("\nRe-run this script anytime to reset to a clean demo state.\n");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
