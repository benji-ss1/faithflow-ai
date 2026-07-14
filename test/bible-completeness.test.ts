/**
 * Bible completeness + reference-parser edge-case tests.
 *
 * Run: npx tsx --env-file=.env.local test/bible-completeness.test.ts
 *
 * Uses plain node:assert (same pattern as test/adversarial/*).
 */
import "dotenv/config";
import assert from "node:assert";
import { getDb } from "../src/lib/db/client";
import { sql } from "drizzle-orm";
import { parseReference } from "../src/lib/bible-parser";
import { lookupReference } from "../src/lib/server/bible";

let pass = 0;
let fail = 0;
function check(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve(fn())
    .then(() => { console.log(`  PASS  ${name}`); pass++; })
    .catch((e) => { console.error(`  FAIL  ${name}\n         ${(e as Error).message}`); fail++; });
}

async function main() {
  const db = getDb();
  const rows = (await db.execute(sql`SELECT id, code FROM bible_translations`)).rows as { id: string; code: string }[];
  const byCode = new Map(rows.map((r) => [r.code, r.id]));
  const kjv = byCode.get("KJV")!;
  const web = byCode.get("WEB")!;

  const bookCount = async (t: string) =>
    ((await db.execute(sql`SELECT COUNT(DISTINCT book)::int AS n FROM bible_verses WHERE translation_id = ${t}`)).rows[0] as { n: number }).n;
  const chapterCount = async (t: string, book: string) =>
    ((await db.execute(sql`SELECT COUNT(DISTINCT chapter)::int AS n FROM bible_verses WHERE translation_id = ${t} AND book = ${book}`)).rows[0] as { n: number }).n;
  const verseCount = async (t: string) =>
    ((await db.execute(sql`SELECT COUNT(*)::int AS n FROM bible_verses WHERE translation_id = ${t}`)).rows[0] as { n: number }).n;
  const getVerse = async (t: string, book: string, ch: number, v: number) =>
    (await db.execute(sql`SELECT text FROM bible_verses WHERE translation_id = ${t} AND book = ${book} AND chapter = ${ch} AND verse = ${v}`)).rows[0] as { text: string } | undefined;

  await check("KJV has all 66 books", async () => assert.strictEqual(await bookCount(kjv), 66));
  await check("KJV Genesis has 50 chapters", async () => assert.strictEqual(await chapterCount(kjv, "Genesis"), 50));
  await check("KJV John has 21 chapters",    async () => assert.strictEqual(await chapterCount(kjv, "John"), 21));
  await check("KJV Psalms has 150 chapters", async () => assert.strictEqual(await chapterCount(kjv, "Psalms"), 150));
  await check("KJV Revelation has 22 chapters", async () => assert.strictEqual(await chapterCount(kjv, "Revelation"), 22));
  await check("KJV has >=31000 total verses", async () => assert.ok((await verseCount(kjv)) >= 31000, `got ${await verseCount(kjv)}`));
  await check("KJV Genesis 1:1 exists and starts with 'In the beginning'", async () => {
    const v = await getVerse(kjv, "Genesis", 1, 1);
    assert.ok(v, "no verse");
    assert.ok(v!.text.toLowerCase().startsWith("in the beginning"), `got: ${v!.text}`);
  });
  await check("KJV Revelation 22:21 exists and ends with 'Amen.'", async () => {
    const v = await getVerse(kjv, "Revelation", 22, 21);
    assert.ok(v, "no verse");
    assert.ok(v!.text.trim().endsWith("Amen."), `got: ${v!.text}`);
  });
  await check("WEB has all 66 books", async () => assert.strictEqual(await bookCount(web), 66));

  // Per-book presence sweep — assert each canonical book has >=1 verse in KJV + ASV.
  const CANONICAL_BOOKS = [
    "Genesis","Exodus","Leviticus","Numbers","Deuteronomy","Joshua","Judges","Ruth",
    "1 Samuel","2 Samuel","1 Kings","2 Kings","1 Chronicles","2 Chronicles","Ezra","Nehemiah",
    "Esther","Job","Psalms","Proverbs","Ecclesiastes","Song of Solomon","Isaiah","Jeremiah",
    "Lamentations","Ezekiel","Daniel","Hosea","Joel","Amos","Obadiah","Jonah","Micah","Nahum",
    "Habakkuk","Zephaniah","Haggai","Zechariah","Malachi","Matthew","Mark","Luke","John","Acts",
    "Romans","1 Corinthians","2 Corinthians","Galatians","Ephesians","Philippians","Colossians",
    "1 Thessalonians","2 Thessalonians","1 Timothy","2 Timothy","Titus","Philemon","Hebrews",
    "James","1 Peter","2 Peter","1 John","2 John","3 John","Jude","Revelation",
  ];
  const asv = byCode.get("ASV");
  for (const translationCode of (["KJV", "ASV"] as const)) {
    const tid = translationCode === "KJV" ? kjv : asv;
    if (!tid) continue;
    await check(`${translationCode}: every canonical book has >=1 verse`, async () => {
      const rows = (await db.execute(sql`SELECT DISTINCT book FROM bible_verses WHERE translation_id = ${tid}`)).rows as { book: string }[];
      const present = new Set(rows.map((r) => r.book));
      const missing = CANONICAL_BOOKS.filter((b) => !present.has(b));
      assert.strictEqual(missing.length, 0, `missing: ${missing.join(", ")}`);
    });
  }

  // Reference parser edge cases
  const cases: [string, unknown][] = [
    ["John 3:16",              { book: "John",            chapter: 3,  verseStart: 16, verseEnd: 16   }],
    ["1 Cor 13:4-7",           { book: "1 Corinthians",   chapter: 13, verseStart: 4,  verseEnd: 7    }],
    ["Ps 23",                  { book: "Psalms",          chapter: 23, verseStart: 1,  verseEnd: null }],
    ["Rev 22:21",              { book: "Revelation",      chapter: 22, verseStart: 21, verseEnd: 21   }],
    ["Song of Solomon 1:1",    { book: "Song of Solomon", chapter: 1,  verseStart: 1,  verseEnd: 1    }],
    ["SoS 1:1",                { book: "Song of Solomon", chapter: 1,  verseStart: 1,  verseEnd: 1    }],
    ["Philemon 1:1",           { book: "Philemon",        chapter: 1,  verseStart: 1,  verseEnd: 1    }],
    ["3 John 1:1",             { book: "3 John",          chapter: 1,  verseStart: 1,  verseEnd: 1    }],
    ["John three sixteen",     { book: "John",            chapter: 3,  verseStart: 16, verseEnd: 16   }],
    // R2: compound spoken numbers ("twenty three" → 23) + Psalms whole-chapter default.
    ["Psalm twenty three",         { book: "Psalms", chapter: 23,  verseStart: 1, verseEnd: null }],
    ["Psalm 23",                   { book: "Psalms", chapter: 23,  verseStart: 1, verseEnd: null }],
    ["Psalm 119",                  { book: "Psalms", chapter: 119, verseStart: 1, verseEnd: null }],
    ["Psalm twenty three verse one", { book: "Psalms", chapter: 23, verseStart: 1, verseEnd: 1  }],
    ["Psalm 23:1",                 { book: "Psalms", chapter: 23,  verseStart: 1, verseEnd: 1    }],
  ];
  for (const [input, expected] of cases) {
    await check(`parseReference("${input}")`, () => {
      const got = parseReference(input);
      assert.deepStrictEqual(got, expected);
    });
  }
  await check('parseReference("junk input") returns null', () => {
    assert.strictEqual(parseReference("junk input"), null);
  });

  // Empty / whitespace input
  await check('parseReference("") returns null', () => {
    assert.strictEqual(parseReference(""), null);
  });
  await check('parseReference("   ") returns null', () => {
    assert.strictEqual(parseReference("   "), null);
  });

  // R2 false-positive suppression: 2-letter English-word aliases dropped.
  await check('parseReference("I am 34 years old") returns null', () => {
    assert.strictEqual(parseReference("I am 34 years old"), null);
  });
  await check('parseReference("this is chapter three of my life") returns null', () => {
    assert.strictEqual(parseReference("this is chapter three of my life"), null);
  });
  await check('parseReference("re: the meeting") returns null', () => {
    assert.strictEqual(parseReference("re: the meeting"), null);
  });

  // Y6: Roman-numeral prefix abbreviation
  await check('parseReference("I Cor 13:4")', () => {
    assert.deepStrictEqual(parseReference("I Cor 13:4"), {
      book: "1 Corinthians", chapter: 13, verseStart: 4, verseEnd: 4,
    });
  });

  // Y3: cross-chapter range
  await check('parseReference("John 3:16-4:3") — cross-chapter range', () => {
    const got = parseReference("John 3:16-4:3");
    assert.deepStrictEqual(got, {
      book: "John", chapter: 3, verseStart: 16, verseEnd: 3, chapterEnd: 4,
    });
  });
  await check("invalid ref John 99:99 has no verse row", async () => {
    const v = await getVerse(kjv, "John", 99, 99);
    assert.strictEqual(v, undefined);
  });

  // Multi-verse rendering (fix #1). lookupReference must return every verse in
  // the range, not just the first one.
  await check("lookupReference(Genesis 4:1-7) returns 7 verses", async () => {
    const verses = await lookupReference(kjv, "Genesis", 4, 1, 7);
    assert.strictEqual(verses.length, 7, `expected 7 verses, got ${verses.length}`);
    assert.strictEqual(verses[0].verse, 1);
    assert.strictEqual(verses[6].verse, 7);
  });
  await check("lookupReference(Psalms 23:1-6) returns 6 verses", async () => {
    const verses = await lookupReference(kjv, "Psalms", 23, 1, 6);
    assert.strictEqual(verses.length, 6);
  });
  await check("lookupReference cross-chapter (Colossians 4:4-5) returns >=2 chapters worth", async () => {
    // Col 3 has 25 verses; Col 4 has 18. Range 3:20-4:2 spans a chapter boundary.
    const verses = await lookupReference(kjv, "Colossians", 3, 20, 2, 4);
    assert.ok(verses.length >= 8, `expected >=8 verses across chapters, got ${verses.length}`);
    assert.ok(verses.some((v) => v.chapter === 3), "must include a chapter 3 verse");
    assert.ok(verses.some((v) => v.chapter === 4), "must include a chapter 4 verse");
    // Ordering: chapter asc then verse asc.
    for (let i = 1; i < verses.length; i++) {
      const prev = verses[i - 1];
      const cur = verses[i];
      const cmp = cur.chapter !== prev.chapter ? cur.chapter - prev.chapter : cur.verse - prev.verse;
      assert.ok(cmp > 0, `verses out of order at ${i}`);
    }
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
