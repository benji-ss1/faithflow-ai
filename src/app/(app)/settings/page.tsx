import { eq } from "drizzle-orm";
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

  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="Settings"
        title="Settings"
        description="Church-level defaults for display, Bible behavior, and AI-related preferences. This page stays separate from the operator runtime."
      />
      <SettingsForm
        display={{ blankBgColor: display?.blankBgColor || "#000000" }}
        prefs={{
          defaultTranslationId: prefs?.defaultTranslationId || null,
          aiListeningDefault: prefs?.aiListeningDefault ?? false,
          audioInputDeviceLabel: prefs?.audioInputDeviceLabel || null,
          detectionConfidenceThreshold: prefs?.detectionConfidenceThreshold ?? 60,
          productionMode: prefs?.productionMode ?? false,
          transcriptRetentionDays: prefs?.transcriptRetentionDays ?? 90,
          commandPrefix: prefs?.commandPrefix ?? "faithflow",
          autoApproveEnabled: prefs?.autoApproveEnabled ?? false,
          autoApproveThreshold: prefs?.autoApproveThreshold ?? 90,
          autoSendToLive: prefs?.autoSendToLive ?? false,
        }}
        translations={translations.filter((t) => !t.licenseRequired)}
      />
      <div className="mt-10">
        <TranslationsPanel translations={translations} />
      </div>
    </div>
  );
}
