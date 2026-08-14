import { requireUser } from "@/lib/session";
import { listThemes } from "@/lib/server/services";
import { getDb } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { presignGet } from "@/lib/s3";
import { PageHeader } from "@/components/layout/PageHeader";
import { ThemesManager } from "@/components/library/ThemesManager";

export default async function ThemesPage() {
  const user = await requireUser();
  const db = getDb();
  const [rows, settingsRow] = await Promise.all([
    listThemes(user.churchId),
    db.select({ logoS3Key: settings.logoS3Key }).from(settings).where(eq(settings.churchId, user.churchId)).limit(1),
  ]);
  const { refreshThemeMediaUrls } = await import("@/lib/server/theming");
  const themes = await Promise.all(rows.map(async (r: typeof rows[number]) => ({
    id: r.id,
    name: r.name,
    // Re-sign expiring media URLs so theme backgrounds/logos never 404.
    config: ((await refreshThemeMediaUrls(r.config)) as Record<string, unknown>) ?? {},
    isDefault: r.isDefault ?? false,
  })));
  const logoKey = settingsRow[0]?.logoS3Key;
  const churchLogoUrl = logoKey ? await presignGet(logoKey) : null;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Library"
        title="Presentation themes"
        description="Reusable slide themes — colours, fonts, and transitions your church can apply to any song with one click."
      />
      <ThemesManager themes={themes} churchLogoUrl={churchLogoUrl} />
    </div>
  );
}
