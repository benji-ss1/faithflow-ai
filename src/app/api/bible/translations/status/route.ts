import { NextResponse } from "next/server";
import { apiUser } from "@/lib/session";
import { listTranslations, listBooks } from "@/lib/server/bible";

export const runtime = "nodejs";

/**
 * GET /api/bible/translations/status
 *
 * Returns per-translation download status so the Bible Store UI can show
 * real "Downloaded" / "Partial (X/66)" / not-downloaded state instead of
 * a hard-coded truthy label. Auth-gated — no data leaks pre-login.
 *
 * Shape: { translations: [{ code, name, licenseRequired, books, downloaded, partial }] }
 * where `books` is the count of distinct book rows in bible_verses for
 * that translation (0..66) and `downloaded` is books >= 66.
 */
export async function GET() {
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const translations = await listTranslations();
  const out = await Promise.all(
    translations.map(async (t) => {
      // Licensed translations always report 0 books (verse text isn't stored).
      const bookRows = t.licenseRequired ? [] : await listBooks(t.id);
      const books = bookRows.length;
      return {
        code: t.code,
        name: t.name,
        licenseRequired: t.licenseRequired,
        books,
        downloaded: books >= 66,
        partial: books > 0 && books < 66,
      };
    }),
  );
  return NextResponse.json({ translations: out });
}
