// Adversarial cross-church — sermon service item referencing a PowerPoint import.
// Drives the real guard used by addServiceItem (validateSermonItemPayload).
// RUN: npx tsx --env-file=.env.local test/adversarial/sermon-pptx-cross-church.test.ts
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../../src/lib/db/client";
import { churches, pptxImports } from "../../src/lib/db/schema";
import { validateSermonItemPayload } from "../../src/lib/server/service-item-guards";

const raw = process.env.DATABASE_URL ?? "";
let local = false;
try { const u = new URL(raw); local = ["localhost", "127.0.0.1"].includes(u.hostname) && ![...u.searchParams.keys()].some((k) => ["host", "hostaddr"].includes(k.toLowerCase())); } catch { /* */ }
if (!local) { console.error("REFUSING: DATABASE_URL is not a localhost database."); process.exit(2); }

let failed = 0;
const rec = (name: string, pass: boolean, d = "") => { if (!pass) failed++; console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${d ? ` — ${d}` : ""}`); };

async function main() {
  const db = getDb();
  const [a] = await db.insert(churches).values({ name: "ADV sermon A", timezone: "UTC" }).returning();
  const [b] = await db.insert(churches).values({ name: "ADV sermon B", timezone: "UTC" }).returning();
  try {
    const [imp] = await db.insert(pptxImports).values({ churchId: a.id, originalFileName: "a.pptx", sourceS3Key: `${a.id}/pptx/a.pptx` }).returning();
    const own = await validateSermonItemPayload(db, a.id, { pptxImportId: imp.id });
    rec("church A adds its own pptxImportId", own.ok, JSON.stringify(own));
    const cross = await validateSermonItemPayload(db, b.id, { pptxImportId: imp.id });
    rec("church B cannot add church A's pptxImportId", !cross.ok, JSON.stringify(cross));
    const empty = await validateSermonItemPayload(db, b.id, {});
    rec("plain sermon (no ref) still allowed", empty.ok);
    const junk = await validateSermonItemPayload(db, a.id, { pptxImportId: "not-a-uuid" });
    rec("non-UUID pptxImportId rejected", !junk.ok);
    const missing = await validateSermonItemPayload(db, a.id, { pptxImportId: "00000000-0000-4000-8000-000000000000" });
    rec("nonexistent pptxImportId rejected", !missing.ok);
    const song = await validateSermonItemPayload(db, a.id, { pptxImportId: imp.id, songId: imp.id });
    rec("other library refs still rejected", !song.ok);
    const media = await validateSermonItemPayload(db, a.id, { mediaAssetId: imp.id });
    rec("mediaAssetId on sermon rejected", !media.ok);
  } finally {
    await db.delete(pptxImports).where(inArray(pptxImports.churchId, [a.id, b.id]));
    await db.delete(churches).where(eq(churches.id, a.id));
    await db.delete(churches).where(eq(churches.id, b.id));
  }
  console.log(failed ? `${failed} FAILED` : "all passed");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
