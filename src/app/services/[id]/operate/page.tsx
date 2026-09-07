import { notFound } from "next/navigation";
import { cookies, headers } from "next/headers";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { churchPreferences, bibleTranslations } from "@/lib/db/schema";
import { getExpandedServicePlan } from "@/lib/server/services";
import { OperatorConsole } from "@/components/operator/OperatorConsole";

export default async function OperatePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const cookieStore = await cookies();
  const hdrs = await headers();
  const initialShell: "desktop" | "web" =
    cookieStore.get("pf_shell")?.value === "desktop" || hdrs.get("x-pf-shell") === "desktop"
      ? "desktop"
      : "web";
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
  // Decoupling Phase 3: per-church opt-in for the layers engine.
  // DEPLOY ORDERING (required): the `db.select()` above lists EVERY schema
  // column (including `layers_v2`), so the migration
  // `docs/migrations/2026-09-08-add-church-preferences-layers-v2.sql` MUST be
  // applied to the DB BEFORE this code deploys — otherwise the query throws
  // "column layers_v2 does not exist" and (unlike (app)/operator, this route has
  // no try/catch) the operate page 500s. The `?? false` below only defends the
  // no-row case, NOT an absent column. Once migrated, existing churches read
  // false by default → nothing changes until the flag is deliberately enabled.
  const layersV2 = (prefs as { layersV2?: boolean } | undefined)?.layersV2 ?? false;

  return (
    <OperatorConsole
      plan={plan}
      churchId={user.churchId}
      defaultTranslationCode={translationCode}
      confidenceThreshold={confidenceThreshold}
      autoApprove={autoApprove}
      layersV2={layersV2}
      initialShell={initialShell}
    />
  );
}
