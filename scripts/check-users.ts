import "dotenv/config";
import bcrypt from "bcryptjs";
import { getDb } from "../src/lib/db/client";
import { users } from "../src/lib/db/schema";
import { inArray } from "drizzle-orm";

async function main() {
  const db = getDb();
  const emails = ["operator@demo.church", "demo@jpd.faithflow.ai"];
  const rows = await db.select().from(users).where(inArray(users.email, emails));
  console.log(`Found ${rows.length} user(s):`);
  for (const u of rows) {
    const okOp = await bcrypt.compare("operator123", u.passwordHash).catch(() => false);
    const okJpd = await bcrypt.compare("JpdReview2026!", u.passwordHash).catch(() => false);
    console.log(`  - ${u.email} | church=${u.churchId} | role=${u.role} | pwdOk(operator123)=${okOp} | pwdOk(JpdReview2026!)=${okJpd}`);
  }
  const all = await db.select({ email: users.email }).from(users).limit(20);
  console.log(`\nAll users (up to 20):`);
  for (const u of all) console.log(`  - ${u.email}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
