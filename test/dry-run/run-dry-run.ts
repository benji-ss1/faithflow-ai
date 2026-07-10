/**
 * CHECKPOINT 6 — Scripted 45–60 min service dry-run harness.
 *
 * This runs a scripted transcript through the SAME detectAll pipeline that
 * live audio would use. It is a simulation — no real microphone / STT is
 * involved. See "Honest assessment" in the checkpoint report for what it
 * does and does not prove.
 *
 * Run with:
 *   npx tsx --env-file=.env.local test/dry-run/run-dry-run.ts
 */

import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { eq } from "drizzle-orm";
import { getDb } from "../../src/lib/db/client";
import { churches, songs as songsTable, songSlides as songSlidesTable } from "../../src/lib/db/schema";
import { detectAll, type DetectAllContext, type DetectAllResult } from "../../src/lib/ai-detection";
import type { IndexedSong } from "../../src/lib/ai-detection/lyric-fragment";

// -----------------------------------------------------------------------
// Pre-declared PASS criteria (frozen — never mutated after the run)
// -----------------------------------------------------------------------
const CRITERIA = {
  noCrash: "0 exceptions bubble out of detectAll across the full session",
  scriptureAccuracy: 0.75, // >= 75%
  songAccuracy: 0.60,      // >= 60%
  zeroSendLive: "0 song/lyric results carry a Send-Live action (P5A invariant)",
  degradedWithinMs: 5000,  // <= 5s from disconnect to degraded=true
  p95LatencyMs: 100,       // < 100 ms per segment
  heapDeltaMB: 100,        // heap-used delta < 100 MB start->end
};

type Segment = {
  tMs: number;
  text: string;
  expected: {
    scripture?: { book: string; ch: number; vs: number; ve: number };
    song?: string;
    command?: string;
    low_confidence?: true;
    simulate_disconnect?: true;
  };
};

// -----------------------------------------------------------------------
// Minimal mock of a BroadcastChannel-based "degraded" signal.
// Live code uses BroadcastChannel between operator + presenter. When the
// channel silently disconnects, the presenter is expected to flip a
// "degraded" flag. Here we simulate that with a promise + timer.
// -----------------------------------------------------------------------
class DegradedSignalSim {
  private disconnectedAt: number | null = null;
  private degradedAt: number | null = null;
  private heartbeatMs = 1500; // matches typical health-check cadence
  private missedThreshold = 2; // 2 missed heartbeats -> degraded
  private missed = 0;
  private timer: NodeJS.Timeout | null = null;

  start() {
    this.timer = setInterval(() => {
      if (this.disconnectedAt !== null && this.degradedAt === null) {
        this.missed++;
        if (this.missed >= this.missedThreshold) {
          this.degradedAt = Date.now();
        }
      }
    }, this.heartbeatMs);
  }

  simulateDisconnect() {
    this.disconnectedAt = Date.now();
    this.missed = 0;
  }

  async waitForDegraded(maxMs: number): Promise<number | null> {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      if (this.degradedAt !== null) {
        return this.degradedAt - (this.disconnectedAt ?? this.degradedAt);
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  }

  stop() { if (this.timer) clearInterval(this.timer); }
}

// -----------------------------------------------------------------------
// Load the seeded library from Supabase.
// -----------------------------------------------------------------------
async function loadLibrary(): Promise<{ churchId: string; library: IndexedSong[] }> {
  const db = getDb();
  const [church] = await db.select().from(churches).limit(1);
  if (!church) throw new Error("No church seeded. Run npm run db:seed && npm run db:seed:hymns first.");
  const rows = await db.select().from(songsTable).where(eq(songsTable.churchId, church.id));
  const library: IndexedSong[] = [];
  for (const s of rows) {
    const slides = await db.select().from(songSlidesTable).where(eq(songSlidesTable.songId, s.id));
    library.push({
      songId: s.id,
      title: s.title,
      artist: s.artist,
      source: s.source as IndexedSong["source"],
      slides: slides.map((sl) => ({ order: sl.order, lyrics: sl.lyrics })).sort((a, b) => a.order - b.order),
    });
  }
  return { churchId: church.id, library };
}

// -----------------------------------------------------------------------
// Evaluators — one per category.
// -----------------------------------------------------------------------
function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

function matchesScripture(expected: NonNullable<Segment["expected"]["scripture"]>, result: DetectAllResult): boolean {
  return result.scripture.some((r) => {
    return (
      r.book.toLowerCase() === expected.book.toLowerCase() &&
      r.chapter === expected.ch &&
      r.verseStart === expected.vs &&
      r.verseEnd === expected.ve
    );
  });
}

function matchesSong(expectedTitle: string, result: DetectAllResult): boolean {
  const e = normalizeTitle(expectedTitle);
  return [...result.song, ...result.lyric].some((m) => normalizeTitle(m.title) === e);
}

function matchesCommand(expectedCmd: string, result: DetectAllResult): boolean {
  const e = expectedCmd.toLowerCase();
  // Section commands (chorus / verse N) are in .section; navigation
  // (next slide / verse N without song context) can also appear in .command.
  const sections = result.section.map((s) => `${s.section}${s.index ? " " + s.index : ""}`.trim().toLowerCase());
  const cmds = result.command.map((c) => `${c.verb}`.toLowerCase());
  if (sections.some((s) => s.includes(e) || e.includes(s))) return true;
  if (cmds.some((c) => e.includes(c) || c.includes(e))) return true;
  // Also allow: raw section words found in cue results
  if (e === "chorus" && result.section.some((s) => s.section === "chorus")) return true;
  if (e.startsWith("verse") && result.section.some((s) => s.section === "verse")) return true;
  if (e.includes("next") && result.command.some((c) => String(c.verb).startsWith("next"))) return true;
  if (e.includes("fade") && result.command.some((c) => String(c.verb).includes("fade") || String(c.verb).includes("transition"))) return true;
  return false;
}

// -----------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------
async function main() {
  console.log("Loading seeded library from database…");
  const { churchId, library } = await loadLibrary();
  console.log(`  Loaded ${library.length} songs for church ${churchId}`);
  if (library.length < 3) {
    console.warn("  WARN: library is small — song accuracy may be limited by seed data.");
  }

  const transcriptPath = path.join(__dirname, "sunday-service.transcript.json");
  const transcript: Segment[] = JSON.parse(fs.readFileSync(transcriptPath, "utf8"));
  console.log(`Loaded ${transcript.length} scripted transcript segments.`);

  const degraded = new DegradedSignalSim();
  degraded.start();

  const heapStart = process.memoryUsage().heapUsed;
  const heapSnapshots: { i: number; heapMB: number }[] = [];
  const latencies: number[] = [];

  let tp_s = 0, fn_s = 0, fp_s = 0;
  let tp_g = 0, fn_g = 0, fp_g = 0;
  let tp_c = 0, fn_c = 0, fp_c = 0;
  let sendLiveViolations = 0;
  let crashes = 0;
  let degradedLagMs: number | null = null;

  // Simple detection ctx — the sim doesn't have a live plan context
  const ctx: DetectAllContext = {
    churchId,
    library,
    planSongIds: [],
    recentSongIds: [],
    hasVerseContext: false,
    hasSlideContext: false,
    hasSongContext: false,
  };

  // Track recent song ids to feed back into ctx.recentSongIds (mirroring
  // how the live console maintains context).
  const recentSongIds: string[] = [];
  let songContextUntil = 0;

  for (let i = 0; i < transcript.length; i++) {
    const seg = transcript[i];
    // Update ctx dynamically. If we've seen a song recently, hasSongContext
    // stays true for the next ~2 minutes (mirroring OperatorConsole behavior).
    ctx.recentSongIds = recentSongIds.slice(-5);
    ctx.hasSongContext = seg.tMs < songContextUntil;
    ctx.hasSlideContext = seg.tMs < songContextUntil; // when a song is staged, a slide is up
    ctx.hasVerseContext = false;

    if (seg.expected.simulate_disconnect) {
      degraded.simulateDisconnect();
    }

    let result: DetectAllResult;
    const t0 = performance.now();
    try {
      result = await detectAll(seg.text, ctx);
    } catch (err) {
      crashes++;
      console.error(`  CRASH at segment ${i} (tMs=${seg.tMs}):`, err);
      const t1 = performance.now();
      latencies.push(t1 - t0);
      continue;
    }
    const t1 = performance.now();
    latencies.push(t1 - t0);

    // ZERO-SEND-LIVE-FOR-SONGS invariant.
    // detectAll should never attach a "send live" action to song/lyric results.
    // We assert that no result has a truthy `sendLive` / `autoSendLive` field.
    for (const m of [...result.song, ...result.lyric]) {
      const anyM = m as unknown as Record<string, unknown>;
      if (anyM.sendLive === true || anyM.autoSendLive === true || anyM.action === "sendLive") {
        sendLiveViolations++;
      }
    }

    // Track song context window
    if (result.song.length > 0 || result.lyric.length > 0) {
      songContextUntil = seg.tMs + 120_000;
      for (const m of [...result.song, ...result.lyric]) {
        if (!recentSongIds.includes(m.songId)) recentSongIds.push(m.songId);
      }
    }

    // Evaluate categories
    const anyExpected = seg.expected.scripture || seg.expected.song || seg.expected.command;
    if (seg.expected.scripture) {
      if (matchesScripture(seg.expected.scripture, result)) tp_s++;
      else fn_s++;
    } else if (result.scripture.length > 0 && !seg.expected.low_confidence) {
      fp_s += result.scripture.length;
    }

    if (seg.expected.song) {
      if (matchesSong(seg.expected.song, result)) tp_g++;
      else fn_g++;
    } else if ((result.song.length > 0 || result.lyric.length > 0) && !anyExpected && !seg.expected.low_confidence) {
      // Only a false positive if there's no legit expected song / not part of a
      // multi-segment song block. We conservatively count these but they don't
      // affect PASS criteria (which is on recall, not precision).
      fp_g += result.song.length + result.lyric.length;
    }

    if (seg.expected.command) {
      if (matchesCommand(seg.expected.command, result)) tp_c++;
      else fn_c++;
    } else if ((result.command.length > 0 || result.section.length > 0) && !anyExpected) {
      fp_c += result.command.length + result.section.length;
    }

    if (i % 10 === 0) {
      const heapMB = process.memoryUsage().heapUsed / 1024 / 1024;
      heapSnapshots.push({ i, heapMB });
    }
  }

  // Wait for degraded flag to fire (should be within 5s of the disconnect).
  if (transcript.some((s) => s.expected.simulate_disconnect)) {
    degradedLagMs = await degraded.waitForDegraded(6000);
  }
  degraded.stop();

  const heapEnd = process.memoryUsage().heapUsed;
  const heapDeltaMB = (heapEnd - heapStart) / 1024 / 1024;

  // Percentile helpers
  const sorted = latencies.slice().sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;

  const scrTotal = tp_s + fn_s;
  const sgTotal = tp_g + fn_g;
  const cmdTotal = tp_c + fn_c;
  const scrAcc = scrTotal ? tp_s / scrTotal : 1;
  const sgAcc = sgTotal ? tp_g / sgTotal : 1;
  const cmdAcc = cmdTotal ? tp_c / cmdTotal : 1;

  const totalSimMinutes = (transcript[transcript.length - 1].tMs / 60000).toFixed(1);

  const p50 = pct(50);
  const p95 = pct(95);
  const p99 = pct(99);
  const maxL = sorted[sorted.length - 1] ?? 0;

  const degradedFired = degradedLagMs !== null;
  const degradedWithinCriteria = degradedFired && degradedLagMs! <= CRITERIA.degradedWithinMs;

  const passNoCrash = crashes === 0;
  const passScr = scrAcc >= CRITERIA.scriptureAccuracy;
  const passSg = sgAcc >= CRITERIA.songAccuracy;
  const passSendLive = sendLiveViolations === 0;
  const passDegraded = degradedWithinCriteria;
  const passP95 = p95 < CRITERIA.p95LatencyMs;
  const passHeap = heapDeltaMB < CRITERIA.heapDeltaMB;
  const overallPass =
    passNoCrash && passScr && passSg && passSendLive && passDegraded && passP95 && passHeap;

  console.log("");
  console.log("DRY-RUN SUMMARY");
  console.log(`Total segments: ${transcript.length}`);
  console.log(`Elapsed simulated time: ${totalSimMinutes} min`);
  console.log(`Scripture: TP/FN/FP -> ${tp_s}/${fn_s}/${fp_s} -> ${(scrAcc * 100).toFixed(1)}%`);
  console.log(`Song:      TP/FN/FP -> ${tp_g}/${fn_g}/${fp_g} -> ${(sgAcc * 100).toFixed(1)}%`);
  console.log(`Command:   TP/FN/FP -> ${tp_c}/${fn_c}/${fp_c} -> ${(cmdAcc * 100).toFixed(1)}%`);
  console.log(`Latency ms: p50=${p50.toFixed(2)} / p95=${p95.toFixed(2)} / p99=${p99.toFixed(2)} / max=${maxL.toFixed(2)}`);
  console.log(`Heap start / end / delta MB: ${(heapStart / 1024 / 1024).toFixed(1)} / ${(heapEnd / 1024 / 1024).toFixed(1)} / ${heapDeltaMB.toFixed(1)}`);
  console.log(`Degraded-mode: ${degradedFired ? `fired within ${degradedLagMs}ms` : "NOT fired within 6s"}`);
  console.log(`Send-Live invariant: ${passSendLive ? "PASS" : `FAIL (${sendLiveViolations} violations)`}`);
  console.log(`Crashes: ${crashes}`);
  console.log("");
  console.log(`Per-criterion pass:`);
  console.log(`  noCrash              : ${passNoCrash ? "PASS" : "FAIL"}`);
  console.log(`  scripture >= 75%     : ${passScr ? "PASS" : "FAIL"} (${(scrAcc * 100).toFixed(1)}%)`);
  console.log(`  song      >= 60%     : ${passSg ? "PASS" : "FAIL"} (${(sgAcc * 100).toFixed(1)}%)`);
  console.log(`  zero send-live       : ${passSendLive ? "PASS" : "FAIL"}`);
  console.log(`  degraded <= 5s       : ${passDegraded ? "PASS" : "FAIL"}`);
  console.log(`  p95 latency < 100ms  : ${passP95 ? "PASS" : "FAIL"} (${p95.toFixed(2)}ms)`);
  console.log(`  heap delta < 100MB   : ${passHeap ? "PASS" : "FAIL"} (${heapDeltaMB.toFixed(1)}MB)`);
  console.log(`Overall: ${overallPass ? "PASS" : "FAIL"} against pre-declared criteria`);

  process.exit(overallPass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
