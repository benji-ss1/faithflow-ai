import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { churchPreferences, bibleTranslations } from "@/lib/db/schema";
import { getExpandedServicePlan } from "@/lib/server/services";
import { OperatorConsole } from "@/components/operator/OperatorConsole";

export default async function OperatePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const plan = await getExpandedServicePlan(id, user.churchId);
  if (!plan) notFound();

  const db = getDb();
  const [prefs] = await db.select().from(churchPreferences).where(eq(churchPreferences.churchId, user.churchId)).limit(1);
  let translationCode = "KJV";
  if (prefs?.defaultTranslationId) {
    const [t] = await db.select().from(bibleTranslations).where(eq(bibleTranslations.id, prefs.defaultTranslationId)).limit(1);
    if (t) translationCode = t.code;
  }
  const confidenceThreshold = prefs?.detectionConfidenceThreshold ?? 60;
  const autoApprove = {
    enabled: prefs?.autoApproveEnabled ?? false,
    confidenceFloor: prefs?.autoApproveThreshold ?? 90,
    autoSendToLive: prefs?.autoSendToLive ?? false,
  };

  return (
    <OperatorConsole
      plan={plan}
      defaultTranslationCode={translationCode}
      confidenceThreshold={confidenceThreshold}
      autoApprove={autoApprove}
    />
  );
}
