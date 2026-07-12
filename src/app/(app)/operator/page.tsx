import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { churches, servicePlans, churchPreferences, bibleTranslations, settings as churchSettings } from "@/lib/db/schema";
import { getTodayInChurchTz } from "@/lib/dates";
import { getExpandedServicePlan, type ExpandedPlan } from "@/lib/server/services";
import { presignGet } from "@/lib/s3";
import { OperatorConsole } from "@/components/operator/OperatorConsole";
import { OfflineState } from "./OfflineState";

// Desktop landing surface (PropPresenter-style single view). ALWAYS renders
// the OperatorConsole — no more "empty state" or redirect-away. When a plan
// is scheduled for today (church tz) we load it; otherwise we synthesize an
// ephemeral empty plan so operators land in the same layout and can add
// items from the left library panel.
//
// A per-plan operator page still exists at `/services/[id]/operate` for
// explicit deep-links, and renders visually identical.
export default async function OperatorLandingPage() {
  const user = await requireUser();
  const db = getDb();

  let church: { timezone: string | null } | null = null;
  let plans: Array<{ id: string; title: string; scheduledFor: unknown }> = [];
  let prefs: {
    defaultTranslationId: string | null;
    detectionConfidenceThreshold: number | null;
    autoApproveEnabled: boolean | null;
    autoApproveThreshold: number | null;
    autoSendToLive: boolean | null;
  } | null = null;
  let translationCode = "KJV";
  let logoUrl: string | undefined;
  let blankBgColor = "#000000";
  try {
    church = await db
      .select({ timezone: churches.timezone })
      .from(churches)
      .where(eq(churches.id, user.churchId))
      .limit(1)
      .then((rows) => rows[0] || null);

    plans = await db
      .select({
        id: servicePlans.id,
        title: servicePlans.title,
        scheduledFor: servicePlans.scheduledFor,
      })
      .from(servicePlans)
      .where(eq(servicePlans.churchId, user.churchId));

    const [p] = await db.select().from(churchPreferences).where(eq(churchPreferences.churchId, user.churchId)).limit(1);
    prefs = p ?? null;
    if (prefs?.defaultTranslationId) {
      const [t] = await db.select().from(bibleTranslations).where(eq(bibleTranslations.id, prefs.defaultTranslationId)).limit(1);
      if (t) translationCode = t.code;
    }
    const [s] = await db.select().from(churchSettings).where(eq(churchSettings.churchId, user.churchId)).limit(1);
    if (s?.logoS3Key) logoUrl = await presignGet(s.logoS3Key);
    if (s?.blankBgColor) blankBgColor = s.blankBgColor;
  } catch (err) {
    console.error("[operator] db read failed", err);
    return <OfflineState />;
  }

  const todayKey = getTodayInChurchTz(church?.timezone);
  // Multi-service same-day: no time-of-day column exists on service_plans; pick
  // smallest id for deterministic behavior. Documented in DECISIONS.md.
  const todaysPlan = plans
    .filter((p) => String(p.scheduledFor) === todayKey)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))[0] || null;

  let plan: ExpandedPlan | null = null;
  if (todaysPlan) {
    plan = await getExpandedServicePlan(todaysPlan.id, user.churchId);
  }
  // Ephemeral empty plan: operator can still use the console (open projector,
  // add items from library, etc.). id="__ephemeral__" is intercepted by the
  // console's server actions — writes are a no-op until a real plan is saved.
  if (!plan) {
    plan = {
      id: "__ephemeral__",
      title: "New service",
      items: [],
      logoUrl,
      blankBgColor,
    };
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
