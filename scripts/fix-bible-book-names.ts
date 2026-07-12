/**
 * One-shot fixer: normalize KJV/ASV book names from Roman-numeral form
 * ("I Samuel", "II Kings", "Revelation of John") to canonical Protestant
 * names ("1 Samuel", "2 Kings", "Revelation") and repair book_order=0.
 *
 * Safe to re-run — every UPDATE is by exact-match on the wrong value.
 *
 * Invocation (required): `--confirm` flag. Refuses to run without it so a
 * stray `tsx` in the wrong shell can't mutate the DB. Indexes are NOT
 * managed here — see src/lib/db/schema.ts (idx_bible_verses_lookup /
 * idx_bible_verses_book_lower) and drizzle migrations.
 */
import "dotenv/config";
import { getDb } from "../src/lib/db/client";
import { sql } from "drizzle-orm";

// Canonical order 1..66
const CANONICAL: [number, string][] = [
  [1, "Genesis"], [2, "Exodus"], [3, "Leviticus"], [4, "Numbers"], [5, "Deuteronomy"],
  [6, "Joshua"], [7, "Judges"], [8, "Ruth"], [9, "1 Samuel"], [10, "2 Samuel"],
  [11, "1 Kings"], [12, "2 Kings"], [13, "1 Chronicles"], [14, "2 Chronicles"],
  [15, "Ezra"], [16, "Nehemiah"], [17, "Esther"], [18, "Job"], [19, "Psalms"], [20, "Proverbs"],
  [21, "Ecclesiastes"], [22, "Song of Solomon"], [23, "Isaiah"], [24, "Jeremiah"],
  [25, "Lamentations"], [26, "Ezekiel"], [27, "Daniel"], [28, "Hosea"], [29, "Joel"], [30, "Amos"],
  [31, "Obadiah"], [32, "Jonah"], [33, "Micah"], [34, "Nahum"], [35, "Habakkuk"], [36, "Zephaniah"],
  [37, "Haggai"], [38, "Zechariah"], [39, "Malachi"],
  [40, "Matthew"], [41, "Mark"], [42, "Luke"], [43, "John"], [44, "Acts"], [45, "Romans"],
  [46, "1 Corinthians"], [47, "2 Corinthians"], [48, "Galatians"], [49, "Ephesians"],
  [50, "Philippians"], [51, "Colossians"], [52, "1 Thessalonians"], [53, "2 Thessalonians"],
  [54, "1 Timothy"], [55, "2 Timothy"], [56, "Titus"], [57, "Philemon"], [58, "Hebrews"],
  [59, "James"], [60, "1 Peter"], [61, "2 Peter"], [62, "1 John"], [63, "2 John"],
  [64, "3 John"], [65, "Jude"], [66, "Revelation"],
];

// Roman-numeral / verbose / ordinal → canonical
const RENAME: Record<string, string> = {
  "I Samuel": "1 Samuel", "II Samuel": "2 Samuel",
  "1st Samuel": "1 Samuel", "2nd Samuel": "2 Samuel",
  "I Kings": "1 Kings", "II Kings": "2 Kings",
  "1st Kings": "1 Kings", "2nd Kings": "2 Kings",
  "I Chronicles": "1 Chronicles", "II Chronicles": "2 Chronicles",
  "1st Chronicles": "1 Chronicles", "2nd Chronicles": "2 Chronicles",
  "I Corinthians": "1 Corinthians", "II Corinthians": "2 Corinthians",
  "1st Corinthians": "1 Corinthians", "2nd Corinthians": "2 Corinthians",
  "I Thessalonians": "1 Thessalonians", "II Thessalonians": "2 Thessalonians",
  "1st Thessalonians": "1 Thessalonians", "2nd Thessalonians": "2 Thessalonians",
  "I Timothy": "1 Timothy", "II Timothy": "2 Timothy",
  "1st Timothy": "1 Timothy", "2nd Timothy": "2 Timothy",
  "I Peter": "1 Peter", "II Peter": "2 Peter",
  "1st Peter": "1 Peter", "2nd Peter": "2 Peter",
  "I John": "1 John", "II John": "2 John", "III John": "3 John",
  "1st John": "1 John", "2nd John": "2 John", "3rd John": "3 John",
  "Revelation of John": "Revelation",
  "Revelation of St. John the Divine": "Revelation",
  "The Revelation": "Revelation",
  "Song of Songs": "Song of Solomon",
  "Canticle of Canticles": "Song of Solomon",
  "Canticles": "Song of Solomon",
  "Psalm": "Psalms",
};

// Translations that intentionally have zero verses (licensed, on-demand only).
const EMPTY_TRANSLATIONS = new Set(["NIV", "ESV", "NKJV"]);

async function main() {
  if (!process.argv.includes("--confirm")) {
    const host = (() => {
      try { return new URL(process.env.DATABASE_URL || "").host; } catch { return "(unset)"; }
    })();
    console.error(`Refusing to run without --confirm. DATABASE_URL host=${host}`);
    process.exit(1);
  }

  const db = getDb();

  // 1) Rename books
  for (const [oldName, newName] of Object.entries(RENAME)) {
    const r = await db.execute(sql`UPDATE bible_verses SET book = ${newName} WHERE book = ${oldName}`);
    const n = (r as unknown as { rowCount: number }).rowCount ?? 0;
    if (n > 0) console.log(`  rename '${oldName}' → '${newName}': ${n} rows`);
  }

  // 2) Reset book_order per canonical map
  for (const [order, name] of CANONICAL) {
    const r = await db.execute(sql`UPDATE bible_verses SET book_order = ${order} WHERE book = ${name} AND book_order <> ${order}`);
    const n = (r as unknown as { rowCount: number }).rowCount ?? 0;
    if (n > 0) console.log(`  book_order ${name} → ${order}: ${n} rows`);
  }

  // 3) Verify — hard-fail if any populated translation is missing books.
  const translations = (await db.execute(sql`SELECT id, code FROM bible_translations ORDER BY code`)).rows as { id: string; code: string }[];
  const failures: string[] = [];
  for (const t of translations) {
    const b = (await db.execute(sql`SELECT COUNT(DISTINCT book)::int AS n FROM bible_verses WHERE translation_id = ${t.id}`)).rows[0] as { n: number };
    const v = (await db.execute(sql`SELECT COUNT(*)::int AS n FROM bible_verses WHERE translation_id = ${t.id}`)).rows[0] as { n: number };
    console.log(`  ${t.code}: books=${b.n}, verses=${v.n}`);
    if (v.n === 0 && EMPTY_TRANSLATIONS.has(t.code)) continue;
    if (v.n === 0) {
      // Populated-list mismatch: unknown empty translation. Warn but don't fail.
      console.warn(`  WARN ${t.code}: zero verses (not in EMPTY_TRANSLATIONS allowlist)`);
      continue;
    }
    if (b.n !== 66) failures.push(`${t.code}: expected 66 books, got ${b.n}`);
  }
  if (failures.length > 0) {
    throw new Error(`Bible completeness check failed:\n  - ${failures.join("\n  - ")}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
