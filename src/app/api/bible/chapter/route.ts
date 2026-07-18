import { NextResponse } from "next/server";
import { apiUser } from "@/lib/session";
import { createLimiter } from "@/lib/rate-limit";
import { getChapter } from "@/lib/server/bible";

export const runtime = "nodejs";

// 60/min matches /api/bible/lookup — enough for interactive verse-by-verse
// browsing, cuts off scraping loops.
const chapterLimiter = createLimiter("bible-chapter", 60, 60_000);

export async function GET(req: Request) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await chapterLimiter(user.id))) {
    return NextResponse.json({ error: "Too many chapter lookups — slow down" }, { status: 429 });
  }
  const url = new URL(req.url);
  const translationId = url.searchParams.get("translationId");
  const book = url.searchParams.get("book");
  const chapter = Number(url.searchParams.get("chapter") || "0");
  if (!translationId || !book || !chapter) return NextResponse.json({ error: "Missing params" }, { status: 400 });
  const verses = await getChapter(translationId, book, chapter);
  return NextResponse.json({ verses });
}
