import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { licensedTranslations, churchPreferences } from "@/lib/db/schema";
import { listTranslations } from "@/lib/server/bible";
import { PageHeader } from "@/components/layout/PageHeader";
import { BibleTranslationsSimple } from "@/components/library/BibleTranslationsSimple";

export default async function BiblePage() {
  const user = await requireUser();
  const db = getDb();
  const allTranslations = await listTranslations();
  const publicTranslations = allTranslations.filter((t) => !t.licenseRequired);
  const licensedSlots = allTranslations.filter((t) => t.licenseRequired);
  const connectedLicensed = await db
    .select()
    .from(licensedTranslations)
    .where(eq(licensedTranslations.churchId, user.churchId));
  const [prefs] = await db
    .select()
    .from(churchPreferences)
    .where(eq(churchPreferences.churchId, user.churchId))
    .limit(1);

  if (publicTranslations.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Bible Library"
          description="Your available translations for use in the desktop app."
        />
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-white/[0.02] p-12 text-center">
          <div className="text-base font-semibold text-foreground">Bible library is warming up</div>
          <p className="max-w-md text-sm text-muted-foreground">
            Public-domain translations (KJV, WEB) are being prepared for your church. This usually completes within a few minutes of first sign-in.
            If you still see this after 10 minutes, contact support and mention &ldquo;bible seed missing&rdquo;.
          </p>
        </div>
      </div>
    );
  }

  const connectedCodes = new Set(connectedLicensed.filter((c) => c.active).map((c) => c.displayCode));
  const cards = [
    ...publicTranslations.map((t) => ({
      id: t.id,
      code: t.code,
      name: t.name,
      status: "included" as const,
      description: "Public-domain translation, ready for use.",
    })),
    ...licensedSlots.map((t) => ({
      id: t.id,
      code: t.code,
      name: t.name,
      status: connectedCodes.has(t.code) ? ("included" as const) : ("licensed" as const),
      description: connectedCodes.has(t.code)
        ? "Connected via licensed provider."
        : "Requires license from the publisher.",
    })),
  ];

  const selectableIds = publicTranslations.map((t) => t.id);
  const defaultId = prefs?.defaultTranslationId
    && selectableIds.includes(prefs.defaultTranslationId)
    ? prefs.defaultTranslationId
    : (publicTranslations.find((t) => t.code === "KJV")?.id ?? publicTranslations[0].id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bible Library"
        description="Your available translations for use in the desktop app."
      />
      <BibleTranslationsSimple
        cards={cards}
        selectableTranslations={publicTranslations.map((t) => ({ id: t.id, code: t.code, name: t.name }))}
        defaultTranslationId={defaultId}
      />
    </div>
  );
}
