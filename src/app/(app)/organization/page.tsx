import { eq } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { bibleTranslations, churches, churchPreferences, settings } from "@/lib/db/schema";
import { presignGet } from "@/lib/s3";
import { PageHeader } from "@/components/layout/PageHeader";
import { AccountCard } from "@/components/account/AccountCard";
import { ChurchProfileForm } from "@/components/organization/ChurchProfileForm";
import { ChurchBrandingUploader } from "@/components/organization/ChurchBrandingUploader";

export default async function OrganizationPage() {
  const admin = await requireRole("admin");
  const db = getDb();
  const [church] = await db.select().from(churches).where(eq(churches.id, admin.churchId)).limit(1);
  const [display] = await db.select().from(settings).where(eq(settings.churchId, admin.churchId)).limit(1);
  const [prefs] = await db.select().from(churchPreferences).where(eq(churchPreferences.churchId, admin.churchId)).limit(1);
  const [translation] = prefs?.defaultTranslationId
    ? await db.select().from(bibleTranslations).where(eq(bibleTranslations.id, prefs.defaultTranslationId)).limit(1)
    : [];
  const logoUrl = display?.logoS3Key ? await presignGet(display.logoS3Key) : null;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Organization"
        title="Church profile"
        description="Operational identity, worship defaults, and account-facing church details. Edit deeper controls from Settings."
      />
      <div className="grid gap-4 xl:grid-cols-2">
        {/* Merged card per Section 8 of the visual-overhaul brief: profile
            editing + worship-side defaults live in one card separated by
            a subtle divider. Dropped the "Onboarding status" detail row —
            it was an internal enum, not user-facing signal. */}
        <AccountCard title="Church details" description="Core profile, worship defaults, and how PresentFlow presents your church across billing, invites, and services.">
          <ChurchProfileForm
            initial={{
              name: church?.name || "",
              timezone: church?.timezone || "UTC",
              city: church?.city || "",
              country: church?.country || "",
              congregationSize: church?.congregationSize ?? null,
              denomination: church?.denomination || "",
            }}
          />
          <div className="mt-6 border-t border-border pt-5">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Worship defaults
            </div>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Detail label="Default Bible translation" value={translation ? `${translation.code} · ${translation.name}` : "Not set"} />
              <Detail label="Blank screen color" value={display?.blankBgColor || "#000000"} />
            </dl>
          </div>
        </AccountCard>
        <AccountCard title="Church branding" description="Upload your logo — it appears in the sidebar, in the desktop app splash, and as a Logo slide in service plans.">
          <div className="pf-admin-scope">
            <ChurchBrandingUploader initialLogoUrl={logoUrl} />
          </div>
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
