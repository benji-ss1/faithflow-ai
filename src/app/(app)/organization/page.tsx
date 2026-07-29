import { eq } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { churches, churchPreferences, settings } from "@/lib/db/schema";
import { presignGet } from "@/lib/s3";
import { PageHeader } from "@/components/layout/PageHeader";
import { AccountCard } from "@/components/account/AccountCard";
import { ChurchProfileForm } from "@/components/organization/ChurchProfileForm";
import { ChurchBrandingUploader } from "@/components/organization/ChurchBrandingUploader";
import { WorshipDefaultsForm } from "@/components/organization/WorshipDefaultsForm";
import { listTranslations } from "@/lib/server/bible";

export default async function OrganizationPage() {
  const admin = await requireRole("admin");
  const db = getDb();
  const [church] = await db.select().from(churches).where(eq(churches.id, admin.churchId)).limit(1);
  const [display] = await db.select().from(settings).where(eq(settings.churchId, admin.churchId)).limit(1);
  const [prefs] = await db.select().from(churchPreferences).where(eq(churchPreferences.churchId, admin.churchId)).limit(1);
  const allTranslations = await listTranslations();
  const publicTranslations = allTranslations
    .filter((t) => !t.licenseRequired)
    .map((t) => ({ id: t.id, code: t.code, name: t.name }));
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
            <WorshipDefaultsForm
              translations={publicTranslations}
              initial={{
                defaultTranslationId: prefs?.defaultTranslationId ?? null,
                blankBgColor: display?.blankBgColor || "#000000",
              }}
            />
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

