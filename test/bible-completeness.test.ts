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
  await check("invalid ref John 99:99 has no verse row", async () => {
    const v = await getVerse(kjv, "John", 99, 99);
    assert.strictEqual(v, undefined);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
