import { requireUser } from "@/lib/session";
import { listThemes } from "@/lib/server/services";
import { PageHeader } from "@/components/layout/PageHeader";
import { ThemesManager } from "@/components/library/ThemesManager";

export default async function ThemesPage() {
  const user = await requireUser();
  const rows = await listThemes(user.churchId);
  const themes = rows.map((r) => ({
    id: r.id,
    name: r.name,
    config: (r.config as Record<string, unknown>) ?? {},
  }));

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Library"
        title="Presentation themes"
        description="Reusable slide themes — colours, fonts, and transitions your church can apply to any song with one click."
      />
      <ThemesManager themes={themes} />
    </div>
  );
}
