import { NextResponse } from "next/server";
import { apiUser } from "@/lib/session";
import { lookupReference, lookupReferenceWithWindow, listTranslations } from "@/lib/server/bible";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { book, chapter, verseStart, verseEnd, translationCode, withWindow } = await req.json().catch(() => ({}));
  if (!book || !chapter || !verseStart || !verseEnd) return NextResponse.json({ error: "Missing params" }, { status: 400 });

  const translations = await listTranslations();
  const t = translationCode ? translations.find((x) => x.code === translationCode) : translations.find((x) => x.code === "KJV") || translations[0];
  if (!t) return NextResponse.json({ error: "No translation available" }, { status: 500 });

  if (withWindow) {
    const { primary, before, after } = await lookupReferenceWithWindow(
      t.id, book, Number(chapter), Number(verseStart), Number(verseEnd), 5,
    );
    return NextResponse.json({ translation: t.code, primary, before, after, verses: primary });
  }
  const verses = await lookupReference(t.id, book, Number(chapter), Number(verseStart), Number(verseEnd));
  return NextResponse.json({ translation: t.code, verses });
}
