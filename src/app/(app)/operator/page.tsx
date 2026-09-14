import { and, desc, eq, sql } from "drizzle-orm";
import { isUuid } from "@/lib/operator-plan-select";
import { cookies, headers } from "next/headers";
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
export default async function OperatorLandingPage({ searchParams }: { searchParams?: Promise<{ plan?: string | string[] }> }) {
  // `?plan=<id>` is stamped into the URL by OperatorConsole once a plan is on
  // screen, so router.refresh() reloads THAT plan instead of re-resolving
  // "today" (which after midnight swapped the operator to a new empty plan).
  const sp = (await searchParams) ?? {};
  const pinnedPlanId = typeof sp.plan === "string" && isUuid(sp.plan) ? sp.plan : null;
  const user = await requireUser();
  const db = getDb();
  const cookieStore = await cookies();
  const hdrs = await headers();
  const initialShell: "desktop" | "web" =
    cookieStore.get("pf_shell")?.value === "desktop" || hdrs.get("x-pf-shell") === "desktop"
      ? "desktop"
      : "web";

  let church: { timezone: string | null } | null = null;
  let todaysPlan: { id: string; title: string; scheduledFor: unknown } | null = null;
  let prefs: {
    defaultTranslationId: string | null;
    detectionConfidenceThreshold: number | null;
    autoApproveEnabled: boolean | null;
    autoApproveThreshold: number | null;
    autoSendToLive: boolean | null;
    layersV2?: boolean | null;
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

    // Y5: SQL-filter to today's plan(s) in the church tz rather than
    // fetching every plan and JS-filtering. Deterministic id-ascending sort
    // preserves the prior "smallest id wins" tiebreak when multiple plans
    // share today's date (multi-service same-day). LIMIT 1 keeps roundtrip
    // small; if the ephemeral fallback is needed the result is simply empty.
    const _todayKey = getTodayInChurchTz(church?.timezone);
    const todayRows = await db
      .select({
        id: servicePlans.id,
        title: servicePlans.title,
        scheduledFor: servicePlans.scheduledFor,
      })
      .from(servicePlans)
      .where(and(
        eq(servicePlans.churchId, user.churchId),
        eq(servicePlans.scheduledFor, _todayKey),
      ))
      .orderBy(desc(servicePlans.createdAt), desc(servicePlans.id))
      .limit(1);
    todaysPlan = todayRows[0] ?? null;

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

  let plan: ExpandedPlan | null = null;
  if (pinnedPlanId) {
    // Church-scoped inside getExpandedServicePlan; a foreign/deleted id → null → fall through.
    plan = await getExpandedServicePlan(pinnedPlanId, user.churchId);
  }
  if (!plan && todaysPlan) {
    plan = await getExpandedServicePlan(todaysPlan.id, user.churchId);
  }
  // No plan for today → create a real one so every server action has a valid
  // UUID to write against. Prior implementation used a "__ephemeral__" sentinel
  // that broke any DB query passing planId unfiltered.
  if (!plan) {
    // Concurrent renders/refreshes used to insert duplicate ad-hoc plans (15ms
    // apart in the field). Serialize per church+date with a transaction-scoped
    // advisory lock, then re-check before inserting. No schema change needed.
    const todayKey = getTodayInChurchTz(church?.timezone);
    const created = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`operator-adhoc:${user.churchId}:${todayKey}`}))`);
      const [existing] = await tx
        .select({ id: servicePlans.id })
        .from(servicePlans)
        .where(and(eq(servicePlans.churchId, user.churchId), eq(servicePlans.scheduledFor, todayKey)))
        .orderBy(desc(servicePlans.createdAt), desc(servicePlans.id))
        .limit(1);
      if (existing) return existing;
      const [row] = await tx
        .insert(servicePlans)
        .values({ churchId: user.churchId, title: "Ad-hoc service", scheduledFor: todayKey })
        .returning({ id: servicePlans.id });
      return row;
    });
    plan = await getExpandedServicePlan(created.id, user.churchId);
    if (!plan) {
      plan = { id: created.id, title: "Ad-hoc service", items: [], logoUrl, blankBgColor };
    }
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
      churchId={user.churchId}
      defaultTranslationCode={translationCode}
      confidenceThreshold={confidenceThreshold}
      autoApprove={autoApprove}
      layersV2={prefs?.layersV2 ?? false}
      initialShell={initialShell}
    />
  );
}
