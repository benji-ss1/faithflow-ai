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
  const translations = await listTranslations();
  const connectedLicensed = await db.select().from(licensedTranslations).where(eq(licensedTranslations.churchId, user.churchId));
  if (translations.length === 0) {
    return (
      <div>
        <PageHeader eyebrow="Library" title="Bible Library" description="Manage public-domain translations now and prepare for licensed providers later." />
        <div className="text-sm text-muted-foreground">
          No translations imported yet. Run <code className="font-mono px-1.5 py-0.5 bg-muted rounded-sm text-xs">npm run db:seed:bible</code> to import KJV and WEB.
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
      <BibleTranslationGrid publicTranslations={translations} licensedTranslations={connectedLicensed} />
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
