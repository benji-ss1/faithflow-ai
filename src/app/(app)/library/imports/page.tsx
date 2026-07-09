import Link from "next/link";
import { requireUser } from "@/lib/session";
import { listPptxImports } from "@/lib/server/services";
import { PageHeader } from "@/components/layout/PageHeader";
import { MediaUploader } from "@/components/library/MediaUploader";
import { PptxRetryButton } from "@/components/library/PptxRetryButton";

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
    <div>
      <PageHeader eyebrow="Library" title="PPTX Imports" action={<MediaUploader purpose="pptx" />} />
      {imports.length === 0 ? (
        <div className="text-sm text-muted-foreground">No imports yet. Upload a .pptx to convert it to slides.</div>
      ) : (
        <ul className="divide-y divide-border border border-border rounded-md">
          {imports.map((p) => (
            <li key={p.id} className="p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <Link href={`/library/imports/${p.id}`} className="font-medium truncate hover:underline block">{p.originalFileName}</Link>
                {p.errorMessage && <div className="text-xs text-destructive mt-1">{p.errorMessage}</div>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {p.status === "failed" && <PptxRetryButton importId={p.id} />}
                <div className={`eyebrow ${STATUS_COLOR[p.status] || ""}`}>{p.status}</div>
                <Link href={`/library/imports/${p.id}`} className="eyebrow underline text-muted-foreground hover:text-foreground">Metadata</Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
