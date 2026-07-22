import Link from "next/link";
import { headers, cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { Monitor, CreditCard, Users, Building2, Download } from "lucide-react";
import { requireUser } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { settings, churchPreferences } from "@/lib/db/schema";
import { listTranslations } from "@/lib/server/bible";
import { PageHeader } from "@/components/layout/PageHeader";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { TranslationsPanel } from "@/components/settings/TranslationsPanel";

export default async function SettingsPage() {
  const user = await requireUser();
  const db = getDb();
  const [display] = await db.select().from(settings).where(eq(settings.churchId, user.churchId)).limit(1);
  const [prefs] = await db.select().from(churchPreferences).where(eq(churchPreferences.churchId, user.churchId)).limit(1);
  const translations = await listTranslations();

  const h = await headers();
  const c = await cookies();
  const isDesktop = h.get("x-pf-shell") === "desktop" || c.get("pf_shell")?.value === "desktop";

  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="Settings"
        title="Settings"
        description={
          isDesktop
            ? "Desktop operator settings — audio input, display, AI listening, transitions. Church admin (billing, team, org) lives on the web portal."
            : "Church-level admin settings for billing, team, and organization. Operator-runtime settings (audio, display) live on the desktop app."
        }
      />

      {isDesktop ? (
        <>
          <SettingsForm
            display={{ blankBgColor: display?.blankBgColor || "#000000" }}
            prefs={{
              defaultTranslationId: prefs?.defaultTranslationId || null,
              aiListeningDefault: prefs?.aiListeningDefault ?? false,
              audioInputDeviceLabel: prefs?.audioInputDeviceLabel || null,
              detectionConfidenceThreshold: prefs?.detectionConfidenceThreshold ?? 60,
              productionMode: prefs?.productionMode ?? false,
              transcriptRetentionDays: prefs?.transcriptRetentionDays ?? 90,
              commandPrefix: prefs?.commandPrefix ?? "presentflow",
              autoApproveEnabled: prefs?.autoApproveEnabled ?? false,
              autoApproveThreshold: prefs?.autoApproveThreshold ?? 90,
              autoSendToLive: prefs?.autoSendToLive ?? false,
            }}
            translations={translations.filter((t) => !t.licenseRequired)}
          />
          <div className="mt-6 rounded-md border border-border bg-card p-4">
            <Link
              href="/settings/screens"
              className="inline-flex items-center gap-2 text-sm font-semibold text-foreground hover:underline"
            >
              <Monitor className="h-4 w-4" /> Configure output screens
            </Link>
            <p className="mt-1 text-xs text-muted-foreground">Map each connected display to an output role (main, stage, lower thirds).</p>
          </div>
          <div className="mt-10">
            <TranslationsPanel translations={translations} />
          </div>
        </>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <AdminLink href="/settings/download" icon={<Download className="h-4 w-4" />} title="Desktop app" hint="Download Present Flow — the live-show tool." />
          <AdminLink href="/settings/billing" icon={<CreditCard className="h-4 w-4" />} title="Billing" hint="Payment health, invoices, ownership." />
          <AdminLink href="/settings/team" icon={<Users className="h-4 w-4" />} title="Team" hint="Members, invitations, roles." />
          <AdminLink href="/organization" icon={<Building2 className="h-4 w-4" />} title="Church profile" hint="Identity, worship defaults, org details." />
          <AdminLink href="/subscriptions" icon={<CreditCard className="h-4 w-4" />} title="Subscriptions" hint="Plan status, usage, renewal." />
        </div>
      )}
    </div>
  );
}

function AdminLink({ href, icon, title, hint }: { href: string; icon: React.ReactNode; title: string; hint: string }) {
  return (
    <Link
      href={href}
      className="rounded-md border border-border bg-card p-4 transition hover:border-foreground/30 hover:bg-accent"
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        {icon} {title}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
    </Link>
  );
}
