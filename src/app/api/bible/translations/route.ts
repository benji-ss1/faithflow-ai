import { NextResponse } from "next/server";
import { apiUser } from "@/lib/session";
import { listTranslations, availableLicensedCodes } from "@/lib/server/bible";

export const runtime = "nodejs";

export async function GET() {
  const user = await apiUser();
  if (!user) return NextResponse.json({ translations: [] }); // don't reveal auth state on a shared read

  // Licensed codes available to this church RIGHT NOW: the church's own active
  // API key rows PLUS the platform-wide global key set (if configured). Uppercase.
  const unlocked = await availableLicensedCodes(user.churchId);

  const all = await listTranslations();
  // Return: public-domain translations always, plus any licensed ones available
  // to the church (own key or global key).
  const translations = all.filter((t) => !t.licenseRequired || unlocked.has(t.code.toUpperCase()));
  return NextResponse.json({ translations });
}
