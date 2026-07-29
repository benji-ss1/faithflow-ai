import Link from "next/link";
import { requireUser } from "@/lib/session";
import { listPptxImports } from "@/lib/server/services";
import { PageHeader } from "@/components/layout/PageHeader";
import { PptxRetryButton } from "@/components/library/PptxRetryButton";
import { PptxDeleteButton } from "@/components/library/PptxDeleteButton";
import { ImportsGrid } from "@/components/library/ImportsGrid";

const STATUS_COLOR: Record<string, string> = {
  pending: "text-muted-foreground",
  converting: "text-warning",
  ready: "text-success",
  failed: "text-destructive",
};

export default async function ImportsPage() {
  const user = await requireUser();
  const imports = await listPptxImports(user.churchId);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Imports & Migration"
        description="Bring your content from other tools into PresentFlow."
      />

      <ImportsGrid />

      {imports.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Recent PowerPoint imports</h2>
          <ul className="divide-y divide-border border border-border rounded-md">
            {imports.map((p) => (
              <li key={p.id} className="p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/library/imports/${p.id}`} className="font-medium truncate hover:underline block">
                    {p.originalFileName}
                  </Link>
                  {p.errorMessage && <div className="text-xs text-destructive mt-1">{p.errorMessage}</div>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {p.status === "failed" && <PptxRetryButton importId={p.id} />}
                  <div className={`eyebrow ${STATUS_COLOR[p.status] || ""}`}>{p.status}</div>
                  <Link href={`/library/imports/${p.id}`} className="eyebrow underline text-muted-foreground hover:text-foreground">
                    Metadata
                  </Link>
                  <PptxDeleteButton importId={p.id} fileName={p.originalFileName} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
