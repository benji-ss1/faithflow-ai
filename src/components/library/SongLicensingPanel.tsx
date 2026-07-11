import { AlertTriangle, FileMusic, ShieldAlert } from "lucide-react";
import { StatusPill } from "@/components/dashboard/DashboardCard";

export function SongLicensingPanel({ songCount, importedCount }: { songCount: number; importedCount: number }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
      <section className="rounded-2xl border border-border bg-card/90 p-5">
        <div className="mb-3 flex items-center gap-2">
          <FileMusic className="h-4 w-4 text-cyan-300" />
          <h2 className="text-base font-semibold">Song licensing and copyright</h2>
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          <StatusPill label={`${songCount} songs in church library`} tone="brand" />
          <StatusPill label={`${importedCount} imported`} tone={importedCount > 0 ? "warning" : "neutral"} />
        </div>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li>PresentFlow stores song lyrics as church-owned or church-imported content, not as a bundled global worship catalog.</li>
          <li>Imported or manually entered copyrighted lyrics remain the church’s licensing responsibility.</li>
          <li>Future fields for CCLI number, copyright footer, and usage reporting should be added before broad commercial rollout.</li>
        </ul>
      </section>

      <section className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5">
        <div className="mb-3 flex items-center gap-2 text-amber-300">
          <ShieldAlert className="h-4 w-4" />
          <h2 className="text-base font-semibold">Import warning</h2>
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          Imports from ProPresenter, EasyWorship, OpenLP, or CSV should be treated as a church-scoped content migration, not as licensed redistribution through PresentFlow.
        </p>
        <div className="rounded-xl border border-white/10 bg-black/10 p-3 text-xs text-muted-foreground">
          <div className="mb-1 font-medium text-foreground">Recommended next metadata fields</div>
          <div>CCLI number, copyright notice, publisher, author list, public-domain flag, import source, usage log count.</div>
        </div>
        <div className="mt-4 flex items-center gap-2 text-xs text-amber-200">
          <AlertTriangle className="h-3.5 w-3.5" />
          Avoid cross-church sharing of copyrighted lyrics.
        </div>
      </section>
    </div>
  );
}
