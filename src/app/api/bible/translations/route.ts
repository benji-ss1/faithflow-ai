import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { apiUser } from "@/lib/session";
import { listTranslations } from "@/lib/server/bible";
import { getDb } from "@/lib/db/client";
import { licensedTranslations } from "@/lib/db/schema";

export const runtime = "nodejs";

export async function GET() {
  const user = await apiUser();
  if (!user) return NextResponse.json({ translations: [] }); // don't reveal auth state on a shared read

  // Fetch all licensedTranslations rows for this church, then filter by active
  // in JS to avoid complex multi-column Drizzle AND expressions.
  const db = getDb();
  const churchLicensed = await db
    .select({ displayCode: licensedTranslations.displayCode, active: licensedTranslations.active })
    .from(licensedTranslations)
    .where(eq(licensedTranslations.churchId, user.churchId));

  // The set of translation codes this church has actively unlocked.
  const unlocked = new Set(
    churchLicensed.filter((r) => r.active).map((r) => r.displayCode),
  );

  const all = await listTranslations();
  // Return: public-domain translations always, plus any licensed ones the
  // church has actively unlocked via their API key.
  const translations = all.filter((t) => !t.licenseRequired || unlocked.has(t.code));
  return NextResponse.json({ translations });
}
