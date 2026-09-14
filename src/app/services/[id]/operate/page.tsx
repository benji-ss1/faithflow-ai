import { notFound } from "next/navigation";
import { cookies, headers } from "next/headers";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { churchPreferences, bibleTranslations } from "@/lib/db/schema";
import { getExpandedServicePlan } from "@/lib/server/services";
import { OperatorConsole } from "@/components/operator/OperatorConsole";
import { SessionKeepAlive } from "@/components/auth/SessionKeepAlive";

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
  // MIGRATION-ORDER HARDENING (R2): the `db.select()` below lists EVERY schema
  // column (including `layers_v2`). The migration
  // `docs/migrations/2026-09-08-add-church-preferences-layers-v2.sql` MUST still
  // be applied to the DB BEFORE this code deploys — that is the correct deploy
  // order and the `?? false` below only defends the no-row case, NOT an absent
  // column. This try/catch is a DEFENCE-IN-DEPTH net (mirrors (app)/operator's
  // pattern): if the read throws (missing column mid-deploy, transient DB error)
  // the operator still lands on a working console with safe defaults instead of
  // a 500 — layers stays off, translation falls back to KJV.
  let prefs:
    | {
        defaultTranslationId: string | null;
        detectionConfidenceThreshold: number | null;
        autoApproveEnabled: boolean | null;
        autoApproveThreshold: number | null;
        autoSendToLive: boolean | null;
        layersV2?: boolean | null;
      }
    | null = null;
  let translationCode = "KJV";
  try {
    const [p] = await db.select().from(churchPreferences).where(eq(churchPreferences.churchId, user.churchId)).limit(1);
    prefs = p ?? null;
    if (prefs?.defaultTranslationId) {
      const [t] = await db.select().from(bibleTranslations).where(eq(bibleTranslations.id, prefs.defaultTranslationId)).limit(1);
      if (t) translationCode = t.code;
    }
  } catch (e) {
    console.error("[operate] church-preferences read failed — falling back to safe defaults:", e instanceof Error ? e.message : String(e));
  }
  const confidenceThreshold = prefs?.detectionConfidenceThreshold ?? 60;
  const autoApprove = {
    enabled: prefs?.autoApproveEnabled ?? false,
    confidenceFloor: prefs?.autoApproveThreshold ?? 90,
    autoSendToLive: prefs?.autoSendToLive ?? false,
  };
  // Decoupling Phase 3: per-church opt-in for the layers engine. Defaults false
  // (no row, absent column, or read failure) → nothing changes until the flag is
  // deliberately enabled AND the global NEXT_PUBLIC_LAYERS_V2 kill-switch is on.
  const layersV2 = prefs?.layersV2 ?? false;

  return (
    <>
    <SessionKeepAlive />
    <OperatorConsole
      plan={plan}
      churchId={user.churchId}
      defaultTranslationCode={translationCode}
      confidenceThreshold={confidenceThreshold}
      autoApprove={autoApprove}
      layersV2={layersV2}
      initialShell={initialShell}
    />
    </>
  );
}
