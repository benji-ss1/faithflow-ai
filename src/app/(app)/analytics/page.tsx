import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";

export default function AnalyticsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Insight"
        title="Analytics"
        description="Attendance, engagement, and content signals across your services — designed to surface only what changes the next service."
      />

      <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-6 shadow-[0_18px_40px_rgba(0,0,0,0.14)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Coming next</div>
            <div className="text-lg font-semibold text-foreground">Signals, not dashboards</div>
            <p className="text-sm leading-6 text-muted-foreground">
              We are intentionally shipping analytics slowly. The first release will roll up sermon summaries,
              archive activity, and song usage into a small set of weekly signals — the ones you would actually
              act on.
            </p>
          </div>
          <Link
            href="/archive"
            className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm font-medium text-foreground transition hover:bg-white/[0.08]"
          >
            Open sermon archive
          </Link>
        </div>
        <ul className="mt-6 grid gap-3 text-sm text-muted-foreground md:grid-cols-3">
          <li className="rounded-xl border border-white/8 bg-black/15 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">Next</div>
            <div className="mt-1 text-sm text-foreground">Weekly sermon + song usage</div>
          </li>
          <li className="rounded-xl border border-white/8 bg-black/15 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">Next</div>
            <div className="mt-1 text-sm text-foreground">Archive engagement (views, exports)</div>
          </li>
          <li className="rounded-xl border border-white/8 bg-black/15 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">Next</div>
            <div className="mt-1 text-sm text-foreground">Prep-time savings per service</div>
          </li>
        </ul>
      </div>
    </div>
  );
}
