import Link from "next/link";
import { requireUser } from "@/lib/session";
import { listSermonSummaries } from "@/lib/server/sermon-summary";
import { PageHeader } from "@/components/layout/PageHeader";
import { ArchiveSearchBar } from "@/components/archive/ArchiveSearchBar";
import { AskSermonHistory } from "@/components/archive/AskSermonHistory";

export default async function ArchivePage({ searchParams }: { searchParams: Promise<{ q?: string; mode?: string }> }) {
  const user = await requireUser();
  const params = await searchParams;
  const keyword = params.q?.trim() || "";
  const mode = params.mode === "semantic" ? "semantic" : "keyword";
  let sermons: Record<string, unknown>[] = [];
  if (mode === "semantic" && keyword) {
    const mod = await import("@/lib/server/sermon-summary");
    sermons = await mod.semanticSermonSearch(user.churchId, keyword, 20);
  } else {
    sermons = await listSermonSummaries(user.churchId, { keyword });
  }
  return (
    <div>
      <PageHeader eyebrow="Archive" title="Sermon archive" />
      <AskSermonHistory />
      <ArchiveSearchBar defaultQuery={keyword} defaultMode={mode} />
      {sermons.length === 0 ? (
        <div className="text-sm text-muted-foreground py-6">
          {keyword ? `No sermons matching "${keyword}"` : "No archived sermons yet. Generate one from a service plan's Operator screen."}
        </div>
      ) : (
        <ul className="space-y-2">
          {sermons.map((s) => (
            <li key={String(s.id)} className="border border-border rounded-md p-4 bg-card hover:bg-accent transition-all">
              <Link href={`/archive/${s.id}`} className="block">
                <div className="flex items-center justify-between mb-1 gap-2">
                  <div className="text-sm font-semibold">{String(s.title || "Untitled")}</div>
                  <div className="text-[10px] text-muted-foreground font-mono shrink-0">
                    {s.generatedAt ? new Date(String(s.generatedAt)).toLocaleDateString() : ""}
                    {typeof s.distance === "number" && <span className="ml-2 text-muted-foreground">sim {(1 - Number(s.distance)).toFixed(3)}</span>}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground line-clamp-2">{String(s.overview || "")}</div>
                {Array.isArray(s.scriptureList) && s.scriptureList.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {(s.scriptureList as { book: string; chapter: number; verseStart: number; verseEnd: number }[]).slice(0, 4).map((r, i) => (
                      <span key={i} className="font-mono text-[10px] px-1.5 py-0.5 rounded-sm border border-border text-muted-foreground">
                        {r.book} {r.chapter}:{r.verseStart}{r.verseStart !== r.verseEnd ? `-${r.verseEnd}` : ""}
                      </span>
                    ))}
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
