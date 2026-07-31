/**
 * E2E test for Bible translations + CCLI workflow.
 * Runs server-side functions directly (bypasses HTTP auth).
 * Run with: npx tsx --env-file=.env.local scripts/test-bible-translations.ts
 */

import { getDb } from "@/lib/db/client";
import { settings, licensedTranslations, bibleTranslations } from "@/lib/db/schema";
import { lookupReference, listTranslations, invalidateLicensedCache } from "@/lib/server/bible";
import { encrypt, decrypt } from "@/lib/server/encryption";
import { API_BIBLE_TRANSLATIONS } from "@/lib/server/api-bible";
import { eq, and } from "drizzle-orm";

const TEST_CHURCH_ID = "c8851abe-f521-4e32-b028-e8685d043f0a";

function pass(msg: string) { console.log(`  ✅ ${msg}`); }
function fail(msg: string) { console.error(`  ❌ ${msg}`); process.exitCode = 1; }
function section(msg: string) { console.log(`\n── ${msg} ──`); }

async function main() {
  const db = getDb();

  // 1. Schema checks
  section("1. Schema checks");
  try {
    const [row] = await db.select({ ccliNumber: settings.ccliNumber })
      .from(settings).where(eq(settings.churchId, TEST_CHURCH_ID)).limit(1);
    pass(`settings.ccliNumber column accessible (value: ${row?.ccliNumber ?? "null"})`);
  } catch (e) {
    fail(`settings.ccliNumber not readable: ${e}`);
  }

  // 2. Encryption round-trip
  section("2. Encryption round-trip");
  try {
    const plain = "test-api-key-99887766";
    const enc = encrypt(plain);
    const dec = decrypt(enc);
    if (dec === plain) {
      pass(`encrypt→decrypt OK (mode: ${enc.startsWith("[unencrypted]") ? "dev-sentinel" : "AES-256-GCM"})`);
    } else {
      fail(`Mismatch: got "${dec}"`);
    }
  } catch (e) { fail(`Encryption error: ${e}`); }

  // 3. Licensed translation seed rows
  section("3. Licensed translation metadata seeding");
  const allRows = await db.select({ code: bibleTranslations.code, licenseRequired: bibleTranslations.licenseRequired })
    .from(bibleTranslations);
  const seeded = ["NIV","NKJV","NLT","AMP"].filter(c => allRows.some(r => r.code === c && r.licenseRequired));
  if (seeded.length === 4) {
    pass(`All 4 licensed translations seeded in bible_translations: ${seeded.join(", ")}`);
  } else {
    fail(`Only ${seeded.length}/4 seeded: ${seeded.join(", ")}`);
    const missing = ["NIV","NKJV","NLT","AMP"].filter(c => !seeded.includes(c));
    console.error(`    Missing: ${missing.join(", ")}`);
  }

  // 4. listTranslations
  section("4. listTranslations()");
  const allTranslations = await listTranslations();
  const publicDomain = allTranslations.filter(t => !t.licenseRequired);
  const licensedMeta = allTranslations.filter(t => t.licenseRequired);
  pass(`Total: ${allTranslations.length} (${publicDomain.length} public-domain, ${licensedMeta.length} licensed-meta)`);

  // 5. Translation visibility filter — before activating
  section("5. Translation filter (simulates GET /api/bible/translations)");
  const existing = await db.select({ displayCode: licensedTranslations.displayCode, active: licensedTranslations.active })
    .from(licensedTranslations)
    .where(and(eq(licensedTranslations.churchId, TEST_CHURCH_ID), eq(licensedTranslations.provider, "api_bible")));
  const unlocked = new Set(existing.filter(r => r.active).map(r => r.displayCode));
  const visibleBefore = allTranslations.filter(t => !t.licenseRequired || unlocked.has(t.code));
  pass(`Before activation: ${visibleBefore.length} visible (${unlocked.size} licensed unlocked)`);

  // 6. Activate (upsert licensedTranslations rows)
  section("6. Activate licensed translations");
  const testKey = process.env.API_BIBLE_KEY || "placeholder-test-key-12345678";
  const encKey = encrypt(testKey);
  for (const t of API_BIBLE_TRANSLATIONS) {
    const [ex] = await db.select({ id: licensedTranslations.id })
      .from(licensedTranslations)
      .where(and(eq(licensedTranslations.churchId, TEST_CHURCH_ID), eq(licensedTranslations.displayCode, t.code)))
      .limit(1);
    if (ex) {
      await db.update(licensedTranslations).set({ apiKeyEncrypted: encKey, active: true })
        .where(and(eq(licensedTranslations.churchId, TEST_CHURCH_ID), eq(licensedTranslations.displayCode, t.code)));
    } else {
      await db.insert(licensedTranslations).values({
        churchId: TEST_CHURCH_ID, provider: "api_bible",
        displayCode: t.code, displayName: t.name, providerBibleId: t.bibleId,
        apiKeyEncrypted: encKey, active: true,
      });
    }
  }
  invalidateLicensedCache(TEST_CHURCH_ID);
  pass(`Upserted ${API_BIBLE_TRANSLATIONS.length} rows with active=true`);

  // Verify visibility after activate
  const existing2 = await db.select({ displayCode: licensedTranslations.displayCode, active: licensedTranslations.active })
    .from(licensedTranslations)
    .where(and(eq(licensedTranslations.churchId, TEST_CHURCH_ID), eq(licensedTranslations.provider, "api_bible")));
  const unlocked2 = new Set(existing2.filter(r => r.active).map(r => r.displayCode));
  const visibleAfter = allTranslations.filter(t => !t.licenseRequired || unlocked2.has(t.code));
  pass(`After activation: ${visibleAfter.length} visible (${unlocked2.size} licensed unlocked: ${[...unlocked2].join(", ")})`);

  // 7. KJV lookup (public domain — baseline check)
  section("7. Public-domain verse lookup (KJV)");
  const kjv = allTranslations.find(t => t.code === "KJV");
  if (!kjv) {
    fail("KJV not found in translations");
  } else {
    const verses = await lookupReference(kjv.id, "John", 3, 16, 16);
    if (verses.length > 0) {
      pass(`KJV John 3:16 ✓ — "${verses[0].text.slice(0, 70)}..."`);
    } else {
      fail("KJV John 3:16 returned 0 verses");
    }
  }

  // 8. Licensed lookups via API.Bible
  section("8. Licensed verse lookup (via API.Bible)");
  const realApiKey = process.env.API_BIBLE_KEY;
  if (!realApiKey) {
    console.log("  ⚠️  API_BIBLE_KEY not set — cannot test live API.Bible calls");
    console.log("     Re-run with: API_BIBLE_KEY=<your_key> npx tsx --env-file=.env.local scripts/test-bible-translations.ts");
  } else {
    // NIV
    const niv = allTranslations.find(t => t.code === "NIV")!;
    const nivVerses = await lookupReference(niv.id, "John", 3, 16, 16, undefined, "NIV", TEST_CHURCH_ID);
    if (nivVerses.length > 0) pass(`NIV John 3:16: "${nivVerses[0].text.slice(0, 80)}..."`);
    else fail("NIV John 3:16 returned 0 verses");

    // NKJV
    const nkjv = allTranslations.find(t => t.code === "NKJV")!;
    const nkjvVerses = await lookupReference(nkjv.id, "Psalms", 23, 1, 1, undefined, "NKJV", TEST_CHURCH_ID);
    if (nkjvVerses.length > 0) pass(`NKJV Psalm 23:1: "${nkjvVerses[0].text.slice(0, 80)}..."`);
    else fail("NKJV Psalm 23:1 returned 0 verses");

    // NLT
    const nlt = allTranslations.find(t => t.code === "NLT")!;
    const nltVerses = await lookupReference(nlt.id, "Romans", 8, 28, 28, undefined, "NLT", TEST_CHURCH_ID);
    if (nltVerses.length > 0) pass(`NLT Romans 8:28: "${nltVerses[0].text.slice(0, 80)}..."`);
    else fail("NLT Romans 8:28 returned 0 verses");

    // AMP
    const amp = allTranslations.find(t => t.code === "AMP")!;
    const ampVerses = await lookupReference(amp.id, "Philippians", 4, 13, 13, undefined, "AMP", TEST_CHURCH_ID);
    if (ampVerses.length > 0) pass(`AMP Phil 4:13: "${ampVerses[0].text.slice(0, 80)}..."`);
    else fail("AMP Phil 4:13 returned 0 verses");
  }

  // 9. CCLI save/read
  section("9. CCLI number save/read");
  const [existingSettings] = await db.select({ id: settings.id }).from(settings)
    .where(eq(settings.churchId, TEST_CHURCH_ID)).limit(1);
  if (existingSettings) {
    await db.update(settings).set({ ccliNumber: "99887766", updatedAt: new Date() })
      .where(eq(settings.churchId, TEST_CHURCH_ID));
  } else {
    await db.insert(settings).values({ churchId: TEST_CHURCH_ID, ccliNumber: "99887766" });
  }
  const [readBack] = await db.select({ ccliNumber: settings.ccliNumber }).from(settings)
    .where(eq(settings.churchId, TEST_CHURCH_ID)).limit(1);
  if (readBack?.ccliNumber === "99887766") {
    pass(`CCLI saved and read back: "${readBack.ccliNumber}"`);
  } else {
    fail(`CCLI mismatch: got "${readBack?.ccliNumber}"`);
  }

  // 10. Deactivate (simulate DELETE /api/settings/bible-api-key)
  section("10. Deactivate (simulate DELETE)");
  await db.update(licensedTranslations).set({ active: false })
    .where(and(eq(licensedTranslations.churchId, TEST_CHURCH_ID), eq(licensedTranslations.provider, "api_bible")));
  invalidateLicensedCache(TEST_CHURCH_ID);
  const afterRevoke = await db.select({ active: licensedTranslations.active }).from(licensedTranslations)
    .where(and(eq(licensedTranslations.churchId, TEST_CHURCH_ID), eq(licensedTranslations.provider, "api_bible")));
  if (afterRevoke.every(r => !r.active)) pass("All 4 rows deactivated");
  else fail("Some rows still active after deactivate");

  // cleanup CCLI
  await db.update(settings).set({ ccliNumber: null, updatedAt: new Date() })
    .where(eq(settings.churchId, TEST_CHURCH_ID));
  pass("CCLI cleaned up");

  // Summary
  console.log("\n══════════════════════════════════════");
  if (process.exitCode === 1) {
    console.error("RESULT: ❌  Some tests FAILED — see ❌ above");
  } else {
    console.log("RESULT: ✅  All tests passed");
  }
  console.log("══════════════════════════════════════\n");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
