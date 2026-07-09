import { NextResponse } from "next/server";
import { apiUser } from "@/lib/session";
import { listTranslations } from "@/lib/server/bible";

export const runtime = "nodejs";

export async function GET() {
  const user = await apiUser();
  if (!user) return NextResponse.json({ translations: [] }); // don't reveal auth state on a shared read
  const translations = await listTranslations();
  return NextResponse.json({ translations });
}
