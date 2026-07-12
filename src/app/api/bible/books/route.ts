import { NextResponse } from "next/server";
import { apiUser } from "@/lib/session";
import { listBooks, listTranslations } from "@/lib/server/bible";

export const runtime = "nodejs";

/**
 * GET /api/bible/books?translationId=...     (legacy)
 * GET /api/bible/books?translation=KJV       (preferred, code-based)
 *
 * Returns { books: [{ book, bookOrder, chapters, testament }] } — 66 rows
 * when the translation is fully seeded. Testament is derived from bookOrder
 * (1–39 = OT, 40–66 = NT).
 */
export async function GET(req: Request) {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  let translationId = url.searchParams.get("translationId");
  const code = url.searchParams.get("translation");

  if (!translationId && code) {
    const translations = await listTranslations();
    const t = translations.find((x) => x.code.toUpperCase() === code.toUpperCase());
    if (!t) return NextResponse.json({ error: "Unknown translation" }, { status: 400 });
    translationId = t.id;
  }
  if (!translationId) {
    // Fall back to first public-domain translation (KJV in most seeds).
    const translations = await listTranslations();
    const t = translations.find((x) => !x.licenseRequired) || translations[0];
    if (!t) return NextResponse.json({ books: [] });
    translationId = t.id;
  }

  const raw = await listBooks(translationId);
  const books = raw.map((r) => ({
    book: r.book,
    bookOrder: r.bookOrder,
    chapters: r.chapters,
    testament: r.bookOrder <= 39 ? "OT" : "NT",
  }));
  return NextResponse.json({ books });
}
