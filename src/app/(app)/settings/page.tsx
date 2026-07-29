import Link from "next/link";
import { headers, cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { Monitor, Download } from "lucide-react";
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
        // Web-mode Settings page: sidebar already surfaces Church Profile,
        // Billing, Team, and Devices as first-class nav entries — repeating
        // them here as tiles was duplication. The one thing that doesn't
        // live in the sidebar is the desktop-app download, so that stays.
        <div className="space-y-4">
          <AdminLink
            href="/onboarding/download"
            icon={<Download className="h-4 w-4" />}
            title="Get the desktop app"
            hint="Present Flow desktop is where you actually run services on Sunday — projector output, stage display, live AI detection."
          />
          <p className="text-xs text-muted-foreground">
            Looking for billing, team members, or your church profile? Those live in the sidebar under
            <span className="font-medium"> People</span> and <span className="font-medium">Admin</span>.
          </p>
        </div>
      )}
    </div>
  );
}

function AdminLink({ href, icon, title, hint }: { href: string; icon: React.ReactNode; title: string; hint: string }) {
  // `block` is essential — <Link> renders as an inline <a>, so without it the
  // rounded border only wraps the text bounding boxes (produced the
  // "two narrow vertical bars" artefact reviewers spotted 2026-07-29).
  return (
    <Link
      href={href}
      className="block rounded-md border border-border bg-card p-4 transition hover:border-foreground/30 hover:bg-accent"
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        {icon} {title}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
    </Link>
  );
}
