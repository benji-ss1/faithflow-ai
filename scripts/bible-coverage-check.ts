/**
 * Read-only check: verifies the Bible library has all 66 books, all
 * expected chapters, and every canonical verse present for at least the
 * default translation. Runs as a one-shot; exits non-zero on gaps.
 */

import { getDb } from "../src/lib/db/client";
import { sql } from "drizzle-orm";

const EXPECTED_BOOKS = 66;
// Canonical Protestant verse count per translation (KJV baseline is 31,102).
const EXPECTED_VERSES_KJV = 31_102;
const EXPECTED_CHAPTERS = 1_189;

async function main() {
  const db = getDb();

  const translations = await db.execute(sql`SELECT id, code, name FROM bible_translations ORDER BY code`);
  console.log(`translations: ${translations.rows.length}`);
  for (const t of translations.rows) console.log(`  - ${t.code} ${t.name}`);

  const books = await db.execute(sql`SELECT COUNT(DISTINCT book) AS n FROM bible_verses`);
  const nBooks = Number(books.rows[0]?.n || 0);
  console.log(`distinct books in bible_verses: ${nBooks} (expected ${EXPECTED_BOOKS})`);

  const chapters = await db.execute(sql`SELECT COUNT(DISTINCT (book, chapter)) AS n FROM bible_verses`);
  const nChapters = Number(chapters.rows[0]?.n || 0);
  console.log(`distinct (book,chapter) pairs: ${nChapters} (expected ${EXPECTED_CHAPTERS})`);

  const verses = await db.execute(sql`SELECT COUNT(*) AS n FROM bible_verses`);
  const nVerses = Number(verses.rows[0]?.n || 0);
  console.log(`total verse rows: ${nVerses}`);

  // Per-translation breakdown
  const perTrans = await db.execute(sql`
    SELECT t.code, COUNT(v.id) AS verse_count, COUNT(DISTINCT v.book) AS book_count
    FROM bible_translations t
    LEFT JOIN bible_verses v ON v.translation_id = t.id
    GROUP BY t.code
    ORDER BY t.code
  `);
  console.log(`\nper-translation coverage:`);
  for (const r of perTrans.rows) {
    console.log(`  ${r.code}: ${r.book_count}/66 books, ${r.verse_count} verses`);
  }

  // Missing book names (compared to standard 66)
  const CANON = [
    "Genesis","Exodus","Leviticus","Numbers","Deuteronomy","Joshua","Judges","Ruth",
    "1 Samuel","2 Samuel","1 Kings","2 Kings","1 Chronicles","2 Chronicles","Ezra","Nehemiah","Esther",
    "Job","Psalms","Proverbs","Ecclesiastes","Song of Solomon",
    "Isaiah","Jeremiah","Lamentations","Ezekiel","Daniel",
    "Hosea","Joel","Amos","Obadiah","Jonah","Micah","Nahum","Habakkuk","Zephaniah","Haggai","Zechariah","Malachi",
    "Matthew","Mark","Luke","John","Acts","Romans","1 Corinthians","2 Corinthians","Galatians","Ephesians","Philippians","Colossians",
    "1 Thessalonians","2 Thessalonians","1 Timothy","2 Timothy","Titus","Philemon","Hebrews","James","1 Peter","2 Peter","1 John","2 John","3 John","Jude","Revelation",
  ];
  const bookList = await db.execute(sql`SELECT DISTINCT book FROM bible_verses`);
  const present = new Set(bookList.rows.map((r) => String(r.book)));
  const missing = CANON.filter((b) => !present.has(b));
  console.log(`\nmissing canonical books (${missing.length}): ${missing.length ? missing.join(", ") : "none"}`);

  // Embedding readiness (semantic scripture detection)
  const embRow = await db.execute(sql`SELECT COUNT(*) AS n FROM bible_verses WHERE embedding IS NOT NULL`);
  const nEmb = Number(embRow.rows[0]?.n || 0);
  console.log(`\nverses with embeddings (semantic search): ${nEmb} / ${nVerses}`);

  const anyKjv = perTrans.rows.find((r) => r.code === "KJV");
  const kjvVerses = anyKjv ? Number(anyKjv.verse_count) : 0;

  const problems: string[] = [];
  if (nBooks < EXPECTED_BOOKS) problems.push(`only ${nBooks}/${EXPECTED_BOOKS} books`);
  if (nChapters < EXPECTED_CHAPTERS) problems.push(`only ${nChapters}/${EXPECTED_CHAPTERS} chapters`);
  if (kjvVerses > 0 && kjvVerses < EXPECTED_VERSES_KJV) problems.push(`KJV has ${kjvVerses}/${EXPECTED_VERSES_KJV} verses`);
  if (nEmb === 0) problems.push(`no verse embeddings — semantic scripture detection will not work`);

  if (problems.length) {
    console.log(`\nSTATUS: gaps found:`);
    for (const p of problems) console.log(`  - ${p}`);
    process.exit(1);
  }
  console.log(`\nSTATUS: bible library ready ✓`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
