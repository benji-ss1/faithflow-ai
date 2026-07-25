import { AlertTriangle, FileMusic } from "lucide-react";
import { StatusPill } from "@/components/dashboard/DashboardCard";

// Section 8 (visual-overhaul brief): the previous version was two side-by-
// side cards ("Song licensing and copyright" + "Import warning"). Merged
// into a single card with the warning surfaced inline as an amber-tinted
// callout at the bottom, so the songs page loses a whole card slot without
// losing any of the CCLI-scope messaging.
export function SongLicensingPanel({ songCount, importedCount }: { songCount: number; importedCount: number }) {
  return (
    <section className="rounded-2xl border border-border bg-card/90 p-5">
      <div className="mb-3 flex items-center gap-2">
        <FileMusic className="h-4 w-4 text-[var(--pf-admin-accent)]" />
        <h2 className="text-base font-semibold">Song licensing &amp; copyright</h2>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <StatusPill label={`${songCount} songs in church library`} tone="brand" />
        <StatusPill label={`${importedCount} imported`} tone={importedCount > 0 ? "warning" : "neutral"} />
      </div>
      <ul className="space-y-2 text-sm text-muted-foreground">
        <li>PresentFlow stores lyrics as church-owned or church-imported content, not a bundled global worship catalog.</li>
        <li>Imported or manually entered copyrighted lyrics remain the church&rsquo;s licensing responsibility.</li>
        <li>Future fields for CCLI number, copyright footer, and usage reporting should ship before broad commercial rollout.</li>
      </ul>

      <div className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-4">
        <div className="mb-1.5 flex items-center gap-2 text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5" />
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em]">Import + share warning</div>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          Imports from ProPresenter, EasyWorship, OpenLP, or CSV should be treated as a church-scoped content migration, not licensed redistribution through PresentFlow. Avoid cross-church sharing of copyrighted lyrics.
        </p>
      </div>
    </section>
  );
}
