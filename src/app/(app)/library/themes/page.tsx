import { PageHeader } from "@/components/layout/PageHeader";

export default function ThemesPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Library"
        title="Presentation themes"
        description="Reusable slide themes, colour palettes, and typography presets applied across every service surface."
      />

      <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-6 shadow-[0_18px_40px_rgba(0,0,0,0.14)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Coming next</div>
            <div className="text-lg font-semibold text-foreground">A calm, curated theme library</div>
            <p className="text-sm leading-6 text-muted-foreground">
              Themes will let your church define a small set of visual identities — a Sunday morning style,
              a midweek style, a special event style — and apply them to every slide surface with one click.
            </p>
          </div>
          <button
            type="button"
            disabled
            title="Available in an upcoming release"
            className="cursor-not-allowed rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm font-medium text-muted-foreground"
          >
            Create theme (soon)
          </button>
        </div>
        <ul className="mt-6 grid gap-3 text-sm text-muted-foreground md:grid-cols-3">
          <li className="rounded-xl border border-white/8 bg-black/15 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">Next</div>
            <div className="mt-1 text-sm text-foreground">Colour tokens per theme</div>
          </li>
          <li className="rounded-xl border border-white/8 bg-black/15 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">Next</div>
            <div className="mt-1 text-sm text-foreground">Typography + heading scale</div>
          </li>
          <li className="rounded-xl border border-white/8 bg-black/15 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">Next</div>
            <div className="mt-1 text-sm text-foreground">Preview against live slide surfaces</div>
          </li>
        </ul>
      </div>
    </div>
  );
}
