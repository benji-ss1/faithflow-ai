import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getChapter } from "@/lib/server/bible";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const translationId = url.searchParams.get("translationId");
  const book = url.searchParams.get("book");
  const chapter = Number(url.searchParams.get("chapter") || "0");
  if (!translationId || !book || !chapter) return NextResponse.json({ error: "Missing params" }, { status: 400 });
  const verses = await getChapter(translationId, book, chapter);
  return NextResponse.json({ verses });
}
