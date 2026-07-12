import "dotenv/config";
import { getDb } from "../src/lib/db/client";
import { sql } from "drizzle-orm";

async function main() {
  const db = getDb();
  const total = (await db.execute(sql`SELECT COUNT(*)::int AS n FROM bible_verses`)).rows;
  console.log("total verses:", total);

  const trans = (await db.execute(sql`SELECT id, code, name FROM bible_translations ORDER BY code`)).rows;
  console.log("translations:", trans);

  for (const t of trans as { id: string; code: string; name: string }[]) {
    const c = (await db.execute(sql`SELECT COUNT(*)::int AS n FROM bible_verses WHERE translation_id = ${t.id}`)).rows;
    const books = (await db.execute(sql`SELECT COUNT(DISTINCT book)::int AS n FROM bible_verses WHERE translation_id = ${t.id}`)).rows;
    console.log(`  ${t.code}: verses=${(c[0] as { n: number }).n}, distinct_books=${(books[0] as { n: number }).n}`);
  }

  // Sample checks vs KJV
  const kjv = (trans as { id: string; code: string }[]).find((t) => t.code === "KJV");
  if (kjv) {
    const g11 = (await db.execute(sql`SELECT text FROM bible_verses WHERE translation_id = ${kjv.id} AND book = 'Genesis' AND chapter = 1 AND verse = 1`)).rows;
    const r2221 = (await db.execute(sql`SELECT text FROM bible_verses WHERE translation_id = ${kjv.id} AND book = 'Revelation' AND chapter = 22 AND verse = 21`)).rows;
    console.log("KJV Gen 1:1 =>", g11[0]);
    console.log("KJV Rev 22:21 =>", r2221[0]);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
