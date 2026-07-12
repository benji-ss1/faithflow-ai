import "dotenv/config";
import { getDb } from "../src/lib/db/client";
import { sql } from "drizzle-orm";

async function main() {
  const db = getDb();
  const kjv = (await db.execute(sql`SELECT id FROM bible_translations WHERE code='KJV'`)).rows[0] as { id: string };
  const books = (await db.execute(sql`SELECT DISTINCT book FROM bible_verses WHERE translation_id = ${kjv.id} ORDER BY book`)).rows.map((r: any) => r.book);
  console.log("KJV books:", books);
  console.log("count:", books.length);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
