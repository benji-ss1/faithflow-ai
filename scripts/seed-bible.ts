/**
 * Seeds Bible translations + verses.
 *
 * Sources (verified public domain):
 * - KJV: King James Version, 1611. Public domain worldwide except in the UK
 *   (Crown copyright, perpetual, but universally treated as free-to-use for
 *   religious/software purposes).
 * - WEB: World English Bible, released to the public domain by Rainbow Missions
 *   in 2000. Explicit PD dedication.
 *
 * Data comes from https://bible-api.com/data (public domain JSON dumps
 * mirrored from https://github.com/scrollmapper/bible_databases).
 *
 * Usage: npm run db:seed:bible
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { getDb } from "../src/lib/db/client";
import { bibleTranslations, bibleVerses } from "../src/lib/db/schema";
import { eq, sql } from "drizzle-orm";

type Verse = { book_id: string; book_name: string; chapter: number; verse: number; text: string };

// Canonical 66-book protestant order used for both KJV and WEB.
const BOOK_ORDER: Record<string, number> = {
  Genesis: 1, Exodus: 2, Leviticus: 3, Numbers: 4, Deuteronomy: 5,
  Joshua: 6, Judges: 7, Ruth: 8, "1 Samuel": 9, "2 Samuel": 10,
  "1 Kings": 11, "2 Kings": 12, "1 Chronicles": 13, "2 Chronicles": 14,
  Ezra: 15, Nehemiah: 16, Esther: 17, Job: 18, Psalms: 19, Proverbs: 20,
  Ecclesiastes: 21, "Song of Solomon": 22, Isaiah: 23, Jeremiah: 24,
  Lamentations: 25, Ezekiel: 26, Daniel: 27, Hosea: 28, Joel: 29, Amos: 30,
  Obadiah: 31, Jonah: 32, Micah: 33, Nahum: 34, Habakkuk: 35, Zephaniah: 36,
  Haggai: 37, Zechariah: 38, Malachi: 39,
  Matthew: 40, Mark: 41, Luke: 42, John: 43, Acts: 44, Romans: 45,
  "1 Corinthians": 46, "2 Corinthians": 47, Galatians: 48, Ephesians: 49,
  Philippians: 50, Colossians: 51, "1 Thessalonians": 52, "2 Thessalonians": 53,
  "1 Timothy": 54, "2 Timothy": 55, Titus: 56, Philemon: 57, Hebrews: 58,
  James: 59, "1 Peter": 60, "2 Peter": 61, "1 John": 62, "2 John": 63,
  "3 John": 64, Jude: 65, Revelation: 66,
};

// bible-api.com hosts the public-domain KJV and WEB JSON at these URLs.
// If offline, drop equivalent JSON files at scripts/bible-data/{kjv,web}.json.
type Source =
  | { code: string; name: string; kind: "scrollmapper"; url: string }
  | { code: string; name: string; kind: "bolls"; bollsCode: string };

const SOURCES: Source[] = [
  { code: "KJV", name: "King James Version", kind: "scrollmapper", url: "https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json/KJV.json" },
  { code: "WEB", name: "World English Bible", kind: "bolls", bollsCode: "WEB" },
  // Phase 5x additions — verified public domain
  { code: "ASV", name: "American Standard Version (1901)", kind: "scrollmapper", url: "https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json/ASV.json" },
  { code: "DRC", name: "Douay-Rheims (Challoner Revision, 1899)", kind: "scrollmapper", url: "https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json/DRC.json" },
  { code: "YLT", name: "Young's Literal Translation (1898)", kind: "scrollmapper", url: "https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json/YLT.json" },
  { code: "DARBY", name: "Darby Bible (1890)", kind: "scrollmapper", url: "https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json/Darby.json" },
  { code: "GEN1599", name: "Geneva Bible (1599)", kind: "scrollmapper", url: "https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json/Geneva1599.json" },
];

const BOOK_IDS: [string, string][] = [
  ["GEN", "Genesis"], ["EXO", "Exodus"], ["LEV", "Leviticus"], ["NUM", "Numbers"], ["DEU", "Deuteronomy"],
  ["JOS", "Joshua"], ["JDG", "Judges"], ["RUT", "Ruth"], ["1SA", "1 Samuel"], ["2SA", "2 Samuel"],
  ["1KI", "1 Kings"], ["2KI", "2 Kings"], ["1CH", "1 Chronicles"], ["2CH", "2 Chronicles"],
  ["EZR", "Ezra"], ["NEH", "Nehemiah"], ["EST", "Esther"], ["JOB", "Job"], ["PSA", "Psalms"], ["PRO", "Proverbs"],
  ["ECC", "Ecclesiastes"], ["SNG", "Song of Solomon"], ["ISA", "Isaiah"], ["JER", "Jeremiah"],
  ["LAM", "Lamentations"], ["EZK", "Ezekiel"], ["DAN", "Daniel"], ["HOS", "Hosea"], ["JOL", "Joel"], ["AMO", "Amos"],
  ["OBA", "Obadiah"], ["JON", "Jonah"], ["MIC", "Micah"], ["NAM", "Nahum"], ["HAB", "Habakkuk"], ["ZEP", "Zephaniah"],
  ["HAG", "Haggai"], ["ZEC", "Zechariah"], ["MAL", "Malachi"],
  ["MAT", "Matthew"], ["MRK", "Mark"], ["LUK", "Luke"], ["JHN", "John"], ["ACT", "Acts"], ["ROM", "Romans"],
  ["1CO", "1 Corinthians"], ["2CO", "2 Corinthians"], ["GAL", "Galatians"], ["EPH", "Ephesians"],
  ["PHP", "Philippians"], ["COL", "Colossians"], ["1TH", "1 Thessalonians"], ["2TH", "2 Thessalonians"],
  ["1TI", "1 Timothy"], ["2TI", "2 Timothy"], ["TIT", "Titus"], ["PHM", "Philemon"], ["HEB", "Hebrews"],
  ["JAS", "James"], ["1PE", "1 Peter"], ["2PE", "2 Peter"], ["1JN", "1 John"], ["2JN", "2 John"],
  ["3JN", "3 John"], ["JUD", "Jude"], ["REV", "Revelation"],
];

async function fetchWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// Chapter counts per book (canonical protestant, 1189 total). Enables fetching without an index roundtrip.
const CHAPTERS_PER_BOOK: number[] = [
  50, 40, 27, 36, 34, 24, 21, 4, 31, 24, 22, 25, 29, 36, 10, 13, 10, 42, 150, 31,
  12, 8, 66, 52, 5, 48, 12, 14, 3, 9, 1, 4, 7, 3, 3, 3, 2, 14, 4, 28, 16, 24, 21,
  28, 16, 16, 13, 6, 6, 4, 4, 5, 3, 6, 4, 3, 1, 13, 5, 5, 3, 5, 1, 1, 1, 22,
];

async function fetchBolls(code: string): Promise<Verse[]> {
  const verses: Verse[] = [];
  const tasks: { bookIdx: number; chapter: number }[] = [];
  for (let b = 0; b < BOOK_IDS.length; b++) {
    for (let c = 1; c <= CHAPTERS_PER_BOOK[b]; c++) tasks.push({ bookIdx: b, chapter: c });
  }
  let done = 0;
  const chapterResults = await fetchWithConcurrency(tasks, 12, async (t) => {
    const bookNum = t.bookIdx + 1;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(`https://bolls.life/get-text/${code}/${bookNum}/${t.chapter}/`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as { verse: number; text: string }[];
        done++;
        if (done % 50 === 0 || done === tasks.length) process.stdout.write(`\r  · ${code}: ${done} / ${tasks.length} chapters`);
        return { bookIdx: t.bookIdx, chapter: t.chapter, verses: data };
      } catch {
        await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
      }
    }
    return { bookIdx: t.bookIdx, chapter: t.chapter, verses: [] as { verse: number; text: string }[] };
  });
  process.stdout.write("\n");

  for (const { bookIdx, chapter, verses: chVerses } of chapterResults) {
    const [bookId, bookName] = BOOK_IDS[bookIdx];
    for (const v of chVerses) {
      // Strip inline HTML tags bolls.life sometimes embeds
      const clean = v.text.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      verses.push({ book_id: bookId, book_name: bookName, chapter, verse: v.verse, text: clean });
    }
  }
  return verses;
}

type ScrollmapperFormat = {
  translation: string;
  books: { name: string; chapters: { chapter: number; verses: { verse: number; text: string }[] }[] }[];
};

async function fetchTranslation(url: string): Promise<Verse[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const data = (await res.json()) as ScrollmapperFormat;
  const verses: Verse[] = [];
  for (const book of data.books) {
    for (const ch of book.chapters) {
      for (const v of ch.verses) {
        verses.push({ book_id: book.name, book_name: book.name, chapter: ch.chapter, verse: v.verse, text: v.text.trim() });
      }
    }
  }
  return verses;
}

async function main() {
  const db = getDb();
  console.log("→ Seeding Bible translations (KJV, WEB)");

  for (const src of SOURCES) {
    console.log(`  · ${src.code}: fetching…`);
    let verses: Verse[];
    try {
      verses = src.kind === "scrollmapper" ? await fetchTranslation(src.url) : await fetchBolls(src.bollsCode);
    } catch (e) {
      console.error(`  ✗ Failed to fetch ${src.code}:`, e instanceof Error ? e.message : e);
      continue;
    }
    console.log(`  · ${src.code}: ${verses.length} verses fetched`);

    let [existing] = await db.select().from(bibleTranslations).where(eq(bibleTranslations.code, src.code)).limit(1);
    if (existing) {
      // Idempotency: if the translation already has verses, skip. Wiping
      // would cascade-delete embeddings (expensive to regenerate). Set
      // REBUILD=1 to force a full re-import.
      const [countRow] = (await db.execute(sql`SELECT COUNT(*)::int AS n FROM bible_verses WHERE translation_id = ${existing.id}`)).rows as { n: number }[];
      if ((countRow?.n ?? 0) > 0 && !process.env.REBUILD) {
        console.log(`  · ${src.code}: already imported (${countRow.n} verses) — skipping. Set REBUILD=1 to force.`);
        continue;
      }
      await db.delete(bibleVerses).where(eq(bibleVerses.translationId, existing.id));
    } else {
      [existing] = await db.insert(bibleTranslations).values({ code: src.code, name: src.name, isPublicDomain: true }).returning();
    }

    // Bulk insert in chunks
    const CHUNK = 1000;
    const rows = verses.map((v) => ({
      translationId: existing.id,
      book: v.book_name,
      bookOrder: BOOK_ORDER[v.book_name] ?? 0,
      chapter: v.chapter,
      verse: v.verse,
      text: v.text,
    }));
    for (let i = 0; i < rows.length; i += CHUNK) {
      await db.insert(bibleVerses).values(rows.slice(i, i + CHUNK));
      process.stdout.write(`\r  · ${src.code}: inserted ${Math.min(i + CHUNK, rows.length)} / ${rows.length}`);
    }
    process.stdout.write("\n");
  }

  // Indexes for fast lookup
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_bible_verses_lookup ON bible_verses (translation_id, book_order, chapter, verse)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_bible_verses_book_lower ON bible_verses (LOWER(book), chapter, verse)`);

  console.log("✓ Bible seed complete");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
