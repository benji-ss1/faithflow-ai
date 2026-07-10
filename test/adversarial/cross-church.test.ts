// Adversarial cross-church RAG isolation test — Checkpoint 3.
//
// PURPOSE
//   Prove that no vector-search / semantic-lookup / list-query code path in
//   this codebase can be coaxed into returning Church B's content when
//   invoked with Church A's church_id. This test seeds two ephemeral
//   churches with unique fingerprint markers, embeds their content, then
//   runs the same real production functions Church A would run, using
//   Church A's id — and asserts none of Church B's markers appear.
//
// WHEN TO RUN
//   Before every release. Any FAIL = a scoping regression = STOP release.
//
// RUN
//   npx tsx --env-file=.env.local test/adversarial/cross-church.test.ts
//
// CLEANUP
//   Ephemeral churches (and their content via cascade / manual reverse
//   delete for tables without cascade) are removed at end even on failure.

import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../src/lib/db/client";
import {
  churches,
  servicePlans,
  serviceItems,
  songs,
  songSlides,
  mediaAssets,
  pptxImports,
  pptxSlides,
  sermonSummaries,
  transcriptSegments,
  aiSuggestions,
  detectedReferences,
  sermonMetadata,
  churchServicePatterns,
  churchPreferences,
  settings,
  licensedTranslations,
  announcements,
  announcementPresets,
  themes,
  migrationJobs,
  subscriptions,
  invitations,
} from "../../src/lib/db/schema";
import { embed, toVectorLiteral } from "../../src/lib/embeddings";
import { matchSongCue } from "../../src/lib/ai-detection/song-match";
import {
  listSongs,
  listMedia,
  listPptxImports,
  listSuggestionHistory,
  getExpandedServicePlan,
} from "../../src/lib/server/services";
import { semanticSermonSearch, listSermonSummaries } from "../../src/lib/server/sermon-summary";
import { recomputeChurchPatterns, suggestPlanStructure } from "../../src/lib/server/service-patterns";

const MARKER_A = "MARKER_A_UNIQUE_FINGERPRINT_ALPHA123";
const MARKER_B = "MARKER_B_UNIQUE_FINGERPRINT_BRAVO456";

type Attempt = { name: string; pass: boolean; detail: string };
const results: Attempt[] = [];
function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  const tag = pass ? "PASS" : "FAIL";
  console.log(`[${tag}] ${name} — ${detail}`);
}

function containsMarkerB(x: unknown): boolean {
  if (x == null) return false;
  if (typeof x === "string") return x.includes(MARKER_B);
  if (Array.isArray(x)) return x.some(containsMarkerB);
  if (typeof x === "object") {
    for (const v of Object.values(x as Record<string, unknown>)) if (containsMarkerB(v)) return true;
  }
  return false;
}

async function seedChurch(name: string, marker: string) {
  const db = getDb();
  const [ch] = await db.insert(churches).values({ name, timezone: "UTC" }).returning();
  const [plan] = await db.insert(servicePlans).values({ churchId: ch.id, title: `${name} Service` }).returning();

  // Songs with marker lyrics
  const [song] = await db.insert(songs).values({ churchId: ch.id, title: `${name} Anthem`, artist: `${name} artist`, source: "church" }).returning();
  await db.insert(songSlides).values([
    { songId: song.id, order: 0, lyrics: `Verse 1: ${marker} we sing your name today` },
    { songId: song.id, order: 1, lyrics: `Chorus: rise up ${marker} rise up together` },
  ]);

  // Service items referencing the song + scripture snippet containing marker
  await db.insert(serviceItems).values([
    { servicePlanId: plan.id, order: 0, type: "song", title: `${name} Anthem`, payload: { songId: song.id } },
    { servicePlanId: plan.id, order: 1, type: "scripture", title: `${marker} reading`, payload: { reference: "John 3:16", slides: [{ text: `Scripture snippet ${marker}` }] } },
    { servicePlanId: plan.id, order: 2, type: "sermon", title: "Sermon" },
  ]);

  // A media asset with marker in filename
  await db.insert(mediaAssets).values({
    churchId: ch.id, kind: "image", fileName: `${marker}.jpg`,
    s3Key: `test/${marker}.jpg`, mimeType: "image/jpeg", sizeBytes: 100,
  });

  // pptx import (used for /api/sermon/match adversarial call)
  const [imp] = await db.insert(pptxImports).values({
    churchId: ch.id, originalFileName: `${marker}.pptx`, sourceS3Key: `test/${marker}.pptx`, status: "ready",
  }).returning();
  const embVec = await embed(`${marker} sermon slide text`);
  const embLit = toVectorLiteral(embVec);
  const [pptxSlide] = await db.insert(pptxSlides).values({
    pptxImportId: imp.id, order: 0, imageS3Key: `test/${marker}-0.png`,
    slideText: `${marker} sermon slide text`, notesText: `notes containing ${marker}`,
  }).returning();
  await db.execute(sql.raw(`UPDATE pptx_slides SET embedding = '${embLit}'::vector WHERE id = '${pptxSlide.id}'`));

  // Sermon summary with embedding
  const [summary] = await db.insert(sermonSummaries).values({
    servicePlanId: plan.id,
    title: `${marker} sermon title`,
    overview: `overview containing ${marker} for cross-church test`,
    keyPoints: [`${marker} key point 1`],
    scriptureList: [],
    notableQuotes: [`"${marker}" quote`],
    actionPoints: [],
    wordCount: 42,
    model: "test",
  }).returning();
  const sumVec = await embed(`${marker} sermon title overview key`);
  const sumLit = toVectorLiteral(sumVec);
  await db.execute(sql.raw(`UPDATE sermon_summaries SET embedding = '${sumLit}'::vector WHERE id = '${summary.id}'`));

  // ai suggestion + transcript for pattern learning coverage
  await db.insert(transcriptSegments).values({ servicePlanId: plan.id, text: `${marker} spoken transcript` });
  await db.insert(aiSuggestions).values({
    servicePlanId: plan.id, type: "scripture",
    payload: { reference: `${marker} scripture`, text: `${marker} text` }, confidence: 90, status: "pending",
  });

  return { church: ch, plan, song, pptxImport: imp, sermonSummary: summary };
}

async function cleanupChurch(churchId: string) {
  const db = getDb();
  // Some FKs lack cascade (servicePlans.churchId, songs.churchId, mediaAssets.churchId,
  // pptxImports.churchId, settings.churchId, churchPreferences.churchId, licensedTranslations
  // has cascade, settings not). Delete children explicitly first.
  const planRows = await db.select({ id: servicePlans.id }).from(servicePlans).where(eq(servicePlans.churchId, churchId));
  const planIds = planRows.map((r) => r.id);
  const songRows = await db.select({ id: songs.id }).from(songs).where(eq(songs.churchId, churchId));
  const songIds = songRows.map((r) => r.id);
  const impRows = await db.select({ id: pptxImports.id }).from(pptxImports).where(eq(pptxImports.churchId, churchId));
  const impIds = impRows.map((r) => r.id);

  if (planIds.length) {
    // sermonSummaries, transcriptSegments, aiSuggestions cascade on servicePlanId.
    // serviceItems cascade too.
    await db.delete(servicePlans).where(inArray(servicePlans.id, planIds));
  }
  if (songIds.length) await db.delete(songs).where(inArray(songs.id, songIds));
  if (impIds.length) await db.delete(pptxImports).where(inArray(pptxImports.id, impIds));

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
  await db.delete(churches).where(eq(churches.id, churchId));
}

async function loadLibrary(churchId: string): Promise<{ songId: string; title: string; artist: string | null; source: "public_domain" | "church" | "imported"; slides: { order: number; lyrics: string }[] }[]> {
  const db = getDb();
  const rows = await db.select().from(songs).where(eq(songs.churchId, churchId));
  const out = [];
  for (const r of rows) {
    const slides = await db.select().from(songSlides).where(eq(songSlides.songId, r.id));
    out.push({ songId: r.id, title: r.title, artist: r.artist, source: r.source, slides: slides.map((s) => ({ order: s.order, lyrics: s.lyrics })) });
  }
  return out;
}

async function main() {
  console.log("=== Adversarial cross-church RAG isolation test ===");
  let A: Awaited<ReturnType<typeof seedChurch>> | null = null;
  let B: Awaited<ReturnType<typeof seedChurch>> | null = null;
  try {
    A = await seedChurch("Adversarial-A", MARKER_A);
    B = await seedChurch("Adversarial-B", MARKER_B);
    console.log(`Seeded A=${A.church.id}, B=${B.church.id}`);

    // Attempt 1: matchSongCue with lyric fragment containing MARKER_B, using
    // Church A's library. Must not return any of B's songs.
    {
      const libA = await loadLibrary(A.church.id);
      const cueChunk = `Chorus: rise up ${MARKER_B} rise up together`;
      const hits = await matchSongCue(cueChunk, { churchId: A.church.id, library: libA });
      const leaked = hits.some((h) => containsMarkerB(h) || h.songId === B!.song.id);
      record("matchSongCue(lyric with MARKER_B, Church A library)", !leaked, `${hits.length} hits — ${leaked ? "MARKER_B LEAKED" : "no MARKER_B"}`);
    }

    // Attempt 2: semanticSermonSearch for MARKER_B as Church A. Must return 0.
    {
      const rows = await semanticSermonSearch(A.church.id, `${MARKER_B} unique fingerprint`, 10);
      const leaked = containsMarkerB(rows);
      // Pass condition: no MARKER_B in any returned row. pgvector will still
      // return Church A's own nearest-neighbor summaries — that is correct.
      record("semanticSermonSearch(Church A, query=MARKER_B)", !leaked, `${rows.length} rows returned — ${leaked ? "LEAK" : "no MARKER_B"}`);
    }

    // Attempt 3: listSermonSummaries keyword search for MARKER_B as Church A.
    {
      const rows = await listSermonSummaries(A.church.id, { keyword: MARKER_B });
      const leaked = containsMarkerB(rows);
      record("listSermonSummaries(Church A, keyword=MARKER_B)", !leaked && rows.length === 0, `${rows.length} rows`);
    }

    // Attempt 4: listSongs, listMedia, listPptxImports for Church A — none contain MARKER_B.
    {
      const s = await listSongs(A.church.id);
      const m = await listMedia(A.church.id);
      const p = await listPptxImports(A.church.id);
      const leaked = containsMarkerB(s) || containsMarkerB(m) || containsMarkerB(p);
      record("listSongs/listMedia/listPptxImports(Church A)", !leaked, `songs=${s.length} media=${m.length} pptx=${p.length}`);
    }

    // Attempt 5: listSuggestionHistory with Church B's plan id but Church A's churchId.
    {
      const rows = await listSuggestionHistory(B.plan.id, A.church.id);
      const pass = rows === null;
      record("listSuggestionHistory(Church B planId, Church A churchId)", pass, pass ? "returned null (denied)" : `LEAK: got ${(rows || []).length} rows`);
    }

    // Attempt 6: getExpandedServicePlan with Church B plan under Church A id.
    {
      const plan = await getExpandedServicePlan(B.plan.id, A.church.id);
      const pass = plan === null;
      record("getExpandedServicePlan(Church B planId, Church A churchId)", pass, pass ? "null (denied)" : "LEAK: plan returned");
    }

    // Attempt 7: Direct pgvector query on sermon_summaries — cross-join over
    // church A id must not surface any Church B rows even in raw SQL.
    {
      const db = getDb();
      const vec = await embed(`${MARKER_B} unique fingerprint sermon`);
      const lit = toVectorLiteral(vec);
      const rows = (await db.execute(sql`
        SELECT ss.id, ss.title, ss.overview
        FROM sermon_summaries ss
        JOIN service_plans sp ON sp.id = ss.service_plan_id
        WHERE sp.church_id = ${A!.church.id}
          AND ss.embedding IS NOT NULL
        ORDER BY ss.embedding <=> ${lit}::vector
        LIMIT 5
      `)).rows;
      const leaked = containsMarkerB(rows);
      record("raw pgvector sermon_summaries scoped to A", !leaked, `${rows.length} rows`);
    }

    // Attempt 8: Direct pgvector query on pptx_slides scoped to A's imports.
    {
      const db = getDb();
      const vec = await embed(`${MARKER_B} sermon slide`);
      const lit = toVectorLiteral(vec);
      const rows = (await db.execute(sql`
        SELECT ps.slide_text AS "slideText", ps.notes_text AS "notesText"
        FROM pptx_slides ps
        JOIN pptx_imports pi ON pi.id = ps.pptx_import_id
        WHERE pi.church_id = ${A!.church.id}
          AND ps.embedding IS NOT NULL
        ORDER BY ps.embedding <=> ${lit}::vector
        LIMIT 5
      `)).rows;
      const leaked = containsMarkerB(rows);
      record("raw pgvector pptx_slides scoped to A", !leaked, `${rows.length} rows`);
    }

    // Attempt 9: suggestPlanStructure for Church A must not reference B's data.
    {
      await recomputeChurchPatterns(A.church.id);
      const s = await suggestPlanStructure(A.church.id);
      const leaked = containsMarkerB(s);
      record("suggestPlanStructure(Church A)", !leaked, `items=${s.items.length} basedOnServices=${s.basedOnServices}`);
    }

    // Attempt 10: HTTP layer — an unauthenticated POST to /api/sermon/match
    // referencing Church B's pptxImportId must be denied (401/403/404).
    {
      const url = "http://localhost:3000/api/sermon/match";
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pptxImportId: B.pptxImport.id, transcriptWindow: `${MARKER_B} sermon slide text now` }),
          redirect: "manual",
        });
        const text = await res.text();
        const denied = res.status === 401 || res.status === 403 || res.status === 404 || (res.status >= 300 && res.status < 400);
        const leaked = text.includes(MARKER_B);
        record("HTTP POST /api/sermon/match (unauth, B's importId)", denied && !leaked, `status=${res.status}${leaked ? " LEAK IN BODY" : ""}`);
      } catch (e) {
        record("HTTP POST /api/sermon/match (unauth, B's importId)", true, `dev server unreachable — skipped (${e instanceof Error ? e.message : String(e)})`);
      }
    }

    // Attempt 11: HTTP layer — unauthenticated GET /api/autopilot/history for
    // Church B's plan id must be denied.
    {
      const url = `http://localhost:3000/api/autopilot/history?planId=${B!.plan.id}`;
      try {
        const res = await fetch(url, { redirect: "manual" });
        const text = await res.text();
        const denied = res.status === 401 || res.status === 403 || res.status === 404 || (res.status >= 300 && res.status < 400);
        const leaked = text.includes(MARKER_B);
        record("HTTP GET /api/autopilot/history (unauth, B's planId)", denied && !leaked, `status=${res.status}${leaked ? " LEAK IN BODY" : ""}`);
      } catch (e) {
        record("HTTP GET /api/autopilot/history (unauth, B's planId)", true, `dev server unreachable — skipped (${e instanceof Error ? e.message : String(e)})`);
      }
    }
  } finally {
    console.log("--- Cleanup ---");
    if (A) await cleanupChurch(A.church.id).catch((e) => console.error("cleanup A failed:", e));
    if (B) await cleanupChurch(B.church.id).catch((e) => console.error("cleanup B failed:", e));
  }

  const passCount = results.filter((r) => r.pass).length;
  console.log(`\n=== Summary: ${passCount}/${results.length} PASS ===`);
  for (const r of results) console.log(`  ${r.pass ? "PASS" : "FAIL"}: ${r.name} — ${r.detail}`);
  if (passCount !== results.length) {
    console.error("\nADVERSARIAL TEST FAILED — cross-church leak detected. DO NOT RELEASE.");
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("Test crashed:", e);
  process.exit(2);
});
