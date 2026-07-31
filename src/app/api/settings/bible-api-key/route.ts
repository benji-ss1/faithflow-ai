import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { apiRequireRole } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { licensedTranslations } from "@/lib/db/schema";
import { encrypt } from "@/lib/server/encryption";
import { API_BIBLE_TRANSLATIONS } from "@/lib/server/api-bible";
import { invalidateLicensedCache } from "@/lib/server/bible";

export const runtime = "nodejs";

// Settings that affect the church's bible licensing are admin-only.
// Operators can look up verses but cannot rotate the API key.
async function requireAdmin() {
  const user = await apiRequireRole("admin");
  if (!user) return null;
  return user;
}

/**
 * GET /api/settings/bible-api-key
 * Returns { status: { code, name, active }[] } — never the actual key.
 * Readable by any authenticated user so operators can see which translations
 * are available. Writing (POST/DELETE) is admin-only.
 */
export async function GET() {
  // Any authenticated user can see which translations are active.
  const user = await apiRequireRole("admin", "operator", "volunteer", "pastor", "viewer");
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const rows = await db
    .select({ displayCode: licensedTranslations.displayCode, active: licensedTranslations.active })
    .from(licensedTranslations)
    .where(
      and(
        eq(licensedTranslations.churchId, user.churchId),
        eq(licensedTranslations.provider, "api_bible"),
      ),
    );

  const status = API_BIBLE_TRANSLATIONS.map((t) => {
    const row = rows.find((r) => r.displayCode === t.code);
    return { code: t.code, name: t.name, active: row?.active ?? false };
  });

  return NextResponse.json({ status });
}

/**
 * POST /api/settings/bible-api-key
 * Body: { apiKey: string }
 * Admin-only. Validates against API.Bible, encrypts the key, upserts all 4
 * licensed_translations rows for this church with active=true.
 */
export async function POST(req: Request) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Forbidden — admin role required" }, { status: 403 });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : null;

  if (!apiKey || apiKey.length < 8) {
    return NextResponse.json({ error: "API key is required" }, { status: 400 });
  }

  // Validate the key against API.Bible before persisting it.
  try {
    const testRes = await fetch(
      // bibleId is hardcoded — not user-supplied, no SSRF surface.
      `https://api.scripture.api.bible/v1/bibles/${API_BIBLE_TRANSLATIONS[0].bibleId}`,
      { headers: { "api-key": apiKey }, signal: AbortSignal.timeout(5000) },
    );
    if (!testRes.ok) {
      return NextResponse.json({ error: "Invalid API.Bible key — please check and try again" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Could not reach API.Bible to verify the key — check your connection" }, { status: 400 });
  }

  const apiKeyEncrypted = encrypt(apiKey);
  const db = getDb();

  // Upsert one row per supported translation.
  for (const t of API_BIBLE_TRANSLATIONS) {
    const existing = await db
      .select({ id: licensedTranslations.id })
      .from(licensedTranslations)
      .where(
        and(
          eq(licensedTranslations.churchId, user.churchId),
          eq(licensedTranslations.displayCode, t.code),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(licensedTranslations)
        .set({ apiKeyEncrypted, active: true })
        .where(
          and(
            eq(licensedTranslations.churchId, user.churchId),
            eq(licensedTranslations.displayCode, t.code),
          ),
        );
    } else {
      await db.insert(licensedTranslations).values({
        churchId: user.churchId,
        provider: "api_bible",
        displayCode: t.code,
        displayName: t.name,
        providerBibleId: t.bibleId,
        apiKeyEncrypted,
        active: true,
      });
    }
  }

  // Bust the in-process licensed-row cache so next lookups see the new key.
  invalidateLicensedCache(user.churchId);

  return NextResponse.json({ ok: true, translations: API_BIBLE_TRANSLATIONS.map((t) => t.code) });
}

/**
 * DELETE /api/settings/bible-api-key
 * Admin-only. Deactivates all API.Bible-provider translations for this church.
 * The encrypted key is retained in case the admin re-enables without re-entering.
 */
export async function DELETE() {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Forbidden — admin role required" }, { status: 403 });

  const db = getDb();
  // Filter by provider so we never accidentally deactivate rows from
  // other future providers (ESV.org, Logos, etc.) added to the same table.
  await db
    .update(licensedTranslations)
    .set({ active: false })
    .where(
      and(
        eq(licensedTranslations.churchId, user.churchId),
        eq(licensedTranslations.provider, "api_bible"),
      ),
    );

  invalidateLicensedCache(user.churchId);
  return NextResponse.json({ ok: true });
}
