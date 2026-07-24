/**
 * Pass 2b — adversarial extension to accuracy-pass2.test.ts (Fable audit).
 *
 * Targets the blind spots of the 2a suite:
 *   B1. STAGE-RANGE triggers on negatives (conf 60–84): not auto-live, but
 *       still an actionable operator prompt → "over-triggering" complaint.
 *   B2. Sermon QUOTING lyrics (not singing) — the classic false auto-live.
 *   B3. Cross-song confusion: two songs sharing a chorus line (decoys).
 *   B4. Interim progression: production fires on partial interims; measure
 *       at which prefix detection first fires and whether an early prefix
 *       fires the WRONG target.
 *   B5. Retrospective/incidental scripture mentions and hymnal page numbers.
 *
 * Same static-transcript constraint as 2a: WER/audio conditions NOT measured.
 * Run: npx tsx test/adversarial/accuracy-pass2b-fable.test.ts
 */
import { detectAll } from "../../src/lib/ai-detection";
import type { IndexedSong } from "../../src/lib/ai-detection/lyric-fragment";

const library: IndexedSong[] = [
  {
    songId: "song-ag", title: "Amazing Grace", artist: "John Newton", source: "public_domain",
    slides: [
      { order: 1, lyrics: "Amazing grace how sweet the sound\nThat saved a wretch like me" },
      { order: 2, lyrics: "I once was lost but now am found\nWas blind but now I see" },
      { order: 3, lyrics: "Through many dangers toils and snares\nI have already come" },
    ],
  },
  // B3 decoy: shares "grace" + "sound" vocabulary with Amazing Grace
  {
    songId: "song-decoy1", title: "Grace So Amazing", artist: "Unknown", source: "church",
    slides: [
      { order: 1, lyrics: "Grace so amazing so sweet the sound of mercy\nFalling like rain on me" },
      { order: 2, lyrics: "Your grace will lead me home again\nAmazing love has found me" },
    ],
  },
  // B3 decoy pair: two songs with a near-identical chorus line
  {
    songId: "song-worthy-a", title: "Worthy Is The Lamb", artist: "Unknown", source: "church",
    slides: [{ order: 1, lyrics: "Worthy is the lamb who was slain\nHoly holy is he" }],
  },
  {
    songId: "song-worthy-b", title: "Worthy Of It All", artist: "Unknown", source: "church",
    slides: [{ order: 1, lyrics: "Worthy is the lamb worthy of it all\nYou are worthy of it all" }],
  },
];

const ctx = {
  churchId: "c1", planSongIds: [], recentSongIds: [], library,
  hasVerseContext: false, hasSlideContext: true, hasSongContext: true,
};

const AUTO_LIVE = 85;   // SONG_AUTOLIVE_CONFIDENCE / scripture auto-fire floor
const STAGE = 60;       // SONG_STAGE_CONFIDENCE — actionable operator prompt

type Row = {
  name: string; kind: "positive" | "negative"; transcript: string;
  songs: { id: string; conf: number }[]; scriptures: { ref: string; conf: number }[];
  top: number;
};

async function probe(name: string, kind: Row["kind"], transcript: string): Promise<Row> {
  const r = await detectAll(transcript, ctx);
  const songs = [...r.song, ...r.lyric]
    .filter((s) => typeof s.songId === "string")
    .map((s) => ({ id: s.songId as string, conf: Math.round(s.confidence) }))
    .sort((a, b) => b.conf - a.conf);
  const scriptures = r.scripture.map((s) => ({
    ref: `${s.book} ${s.chapter}:${s.verseStart}`, conf: Math.round(s.confidence),
  }));
  const top = Math.max(0, ...songs.map((s) => s.conf), ...scriptures.map((s) => s.conf));
  return { name, kind, transcript, songs, scriptures, top };
}

function bucket(top: number): string {
  if (top >= AUTO_LIVE) return "AUTO-LIVE";
  if (top >= STAGE) return "STAGE-PROMPT";
  if (top > 0) return "passive-chip";
  return "silent";
}

async function main() {
  const rows: Row[] = [];

  // ===== B2/B5: negatives that plausibly over-trigger =====
  rows.push(await probe("neg-sermon-quotes-lyric", "negative",
    "as the old hymn says amazing grace how sweet the sound reminds us of gods mercy toward us"));
  rows.push(await probe("neg-sermon-quotes-lyric-short", "negative",
    "amazing grace how sweet the sound is more than a song it is a testimony"));
  rows.push(await probe("neg-retrospective-scripture", "negative",
    "last week we looked at chapter three verse sixteen and many of you were blessed"));
  rows.push(await probe("neg-hymnal-page", "negative",
    "open your hymnal to page forty five and stand with me"));
  rows.push(await probe("neg-offering-numbers", "negative",
    "john gave three thousand and mary gave two hundred to the building fund"));
  rows.push(await probe("neg-announcement-time", "negative",
    "bible study is on wednesday at six thirty in room one oh four"));

  // ===== B3: cross-song confusion =====
  rows.push(await probe("pos-decoy-target-original", "positive",
    "amazing grace how sweet the sound that saved a wretch like me"));
  rows.push(await probe("pos-decoy-target-decoy", "positive",
    "grace so amazing so sweet the sound of mercy falling like rain"));
  rows.push(await probe("pos-shared-chorus-line", "positive",
    "worthy is the lamb")); // ambiguous between worthy-a and worthy-b — what fires?
  rows.push(await probe("pos-shared-chorus-disambig", "positive",
    "worthy is the lamb worthy of it all you are worthy"));

  // ===== B4: interim progression (production fires on partials) =====
  const prefixes = [
    "amazing",
    "amazing grace",
    "amazing grace how",
    "amazing grace how sweet",
    "amazing grace how sweet the sound",
    "amazing grace how sweet the sound that saved",
  ];
  console.log("\n=== B4 interim progression: 'Amazing Grace' word-by-word ===");
  for (const p of prefixes) {
    const r = await probe(`interim[${p.split(" ").length}w]`, "positive", p);
    const best = r.songs[0];
    console.log(`  ${String(p.split(" ").length).padStart(2)}w "${p}" → ${best ? `${best.id}@${best.conf}` : "silent"} [${bucket(r.top)}]${r.songs.length > 1 ? ` runners: ${r.songs.slice(1).map(s => `${s.id}@${s.conf}`).join(", ")}` : ""}`);
  }

  // ===== report =====
  console.log("\n=== B1/B2/B3/B5 scenarios ===");
  for (const r of rows) {
    const detail = [
      ...r.songs.map((s) => `${s.id}@${s.conf}`),
      ...r.scriptures.map((s) => `${s.ref}@${s.conf}`),
    ].join(", ") || "—";
    console.log(`  [${r.kind}] ${r.name} → ${bucket(r.top)} (${detail})`);
  }

  const negs = rows.filter((r) => r.kind === "negative");
  const negAuto = negs.filter((r) => r.top >= AUTO_LIVE);
  const negStage = negs.filter((r) => r.top >= STAGE && r.top < AUTO_LIVE);
  console.log("\n--- Pass 2b metrics ---");
  console.log(`Negatives auto-live (true false-trigger): ${negAuto.length}/${negs.length}${negAuto.length ? " ← " + negAuto.map(r => r.name).join(", ") : ""}`);
  console.log(`Negatives stage-prompt 60-84 (operator distraction): ${negStage.length}/${negs.length}${negStage.length ? " ← " + negStage.map(r => r.name).join(", ") : ""}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
