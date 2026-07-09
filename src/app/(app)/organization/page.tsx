import { eq } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { bibleTranslations, churches, churchPreferences, settings } from "@/lib/db/schema";
import { PageHeader } from "@/components/layout/PageHeader";
import { AccountCard } from "@/components/account/AccountCard";

export default async function OrganizationPage() {
  const admin = await requireRole("admin");
  const db = getDb();
  const [church] = await db.select().from(churches).where(eq(churches.id, admin.churchId)).limit(1);
  const [display] = await db.select().from(settings).where(eq(settings.churchId, admin.churchId)).limit(1);
  const [prefs] = await db.select().from(churchPreferences).where(eq(churchPreferences.churchId, admin.churchId)).limit(1);
  const [translation] = prefs?.defaultTranslationId
    ? await db.select().from(bibleTranslations).where(eq(bibleTranslations.id, prefs.defaultTranslationId)).limit(1)
    : [];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Organization"
        title="Church profile"
        description="Operational identity, worship defaults, and account-facing church details. Edit deeper controls from Settings."
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <AccountCard title="Church details" description="Core profile and ministry context used across billing, invites, and onboarding.">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Detail label="Church name" value={church?.name || "Not set"} />
            <Detail label="Timezone" value={church?.timezone || "UTC"} />
            <Detail label="City" value={church?.city || "Not set"} />
            <Detail label="Country" value={church?.country || "Not set"} />
            <Detail label="Congregation size" value={church?.congregationSize ? church.congregationSize.toString() : "Not set"} />
            <Detail label="Denomination" value={church?.denomination || "Not set"} />
          </dl>
        </AccountCard>
        <AccountCard title="Worship defaults" description="Defaults for screen behavior, Bible selection, and profile readiness.">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Detail label="Default Bible translation" value={translation ? `${translation.code} · ${translation.name}` : "Not set"} />
            <Detail label="Blank screen color" value={display?.blankBgColor || "#000000"} />
            <Detail label="Branding logo" value={display?.logoS3Key ? "Uploaded" : "Not uploaded"} />
            <Detail label="Onboarding status" value={church?.onboardingStatus || "pending"} />
          </dl>
        </AccountCard>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-white/[0.02] p-3">
      <dt className="mb-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}
