import { notFound } from "next/navigation";
import { and, eq, asc } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { pptxImports, pptxSlides, sermonMetadata } from "@/lib/db/schema";
import { PageHeader } from "@/components/layout/PageHeader";
import { SermonMetadataForm } from "@/components/library/SermonMetadataForm";

export default async function ImportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const db = getDb();
  const [imp] = await db.select().from(pptxImports)
    .where(and(eq(pptxImports.id, id), eq(pptxImports.churchId, user.churchId))).limit(1);
  if (!imp) notFound();

  const slides = await db.select().from(pptxSlides).where(eq(pptxSlides.pptxImportId, imp.id)).orderBy(asc(pptxSlides.order));
  const [meta] = await db.select().from(sermonMetadata).where(eq(sermonMetadata.pptxImportId, imp.id)).limit(1);

  const slidesWithText = slides.filter((s) => (s.slideText && s.slideText.length > 0) || (s.notesText && s.notesText.length > 0)).length;

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Import" title={imp.originalFileName} />
      <div className="text-xs text-muted-foreground">
        {slides.length} slides · {slidesWithText} with extracted text · status <span className="font-mono">{imp.status}</span>
      </div>
      <SermonMetadataForm pptxImportId={imp.id} initial={{
        sermonTitle: meta?.sermonTitle ?? null,
        speakerName: meta?.speakerName ?? null,
        series: meta?.series ?? null,
        mainScripture: meta?.mainScripture ?? null,
        notes: meta?.notes ?? null,
        serviceDate: meta?.serviceDate ?? null,
      }} />
    </div>
  );
}
