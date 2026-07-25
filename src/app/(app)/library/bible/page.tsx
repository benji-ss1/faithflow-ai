import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { licensedTranslations } from "@/lib/db/schema";
import { listTranslations, listBooks, embeddedVerseCount } from "@/lib/server/bible";
import { listServicePlans } from "@/lib/server/services";
import { PageHeader } from "@/components/layout/PageHeader";
import { BibleBrowser } from "@/components/library/BibleBrowser";
import { BibleTranslationGrid } from "@/components/library/BibleTranslationGrid";

export default async function BiblePage() {
  const user = await requireUser();
  const db = getDb();
  const allTranslations = await listTranslations();
  const translations = allTranslations.filter((t) => !t.licenseRequired);
  const licensedSlots = allTranslations.filter((t) => t.licenseRequired);
  const connectedLicensed = await db.select().from(licensedTranslations).where(eq(licensedTranslations.churchId, user.churchId));
  if (translations.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Library" title="Bible Library" description="Manage public-domain translations now and prepare for licensed providers later." />
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
  const defaultT = translations.find((t) => t.code === "KJV") || translations[0];
  const [initialBooks, plans, embeddingStatus] = await Promise.all([
    listBooks(defaultT.id),
    listServicePlans(user.churchId),
    embeddedVerseCount(defaultT.id),
  ]);
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Library"
        title="Bible Library"
        description="Public-domain translations are built in for MVP. Licensed translations stay visible, but locked, until a provider or church-owned rights path is connected."
      />
      <BibleTranslationGrid publicTranslations={translations} licensedSlots={licensedSlots} licensedTranslations={connectedLicensed} />
      <BibleBrowser
        translations={translations}
        initialTranslationId={defaultT.id}
        initialBooks={initialBooks}
        plans={plans.map((p) => ({ id: p.id, title: p.title }))}
        embeddingStatus={embeddingStatus}
      />
    </div>
  );
}
