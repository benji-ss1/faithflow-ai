import { NextResponse } from "next/server";
import { apiUser } from "@/lib/session";
import { listTranslations } from "@/lib/server/bible";

export const runtime = "nodejs";

export async function GET() {
  const user = await apiUser();
  if (!user) return NextResponse.json({ translations: [] }); // don't reveal auth state on a shared read
  // Only public-domain translations are exposed here. Licensed slots have no
  // verses stored and MUST NOT appear in the operator picker.
  const translations = (await listTranslations()).filter((t) => !t.licenseRequired);
  return NextResponse.json({ translations });
}
