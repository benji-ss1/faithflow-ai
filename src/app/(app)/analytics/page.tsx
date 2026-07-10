import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { requireUser } from "@/lib/session";
import {
  getRecentServices,
  getAccuracyTrend,
  getTopSongs,
  getTopScriptures,
  getAvgServiceLengthMs,
  getDetectionBreakdown,
  type AccuracyPoint,
} from "@/lib/server/analytics";

export const dynamic = "force-dynamic";

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function Sparkline({ points }: { points: AccuracyPoint[] }) {
  const W = 200;
  const H = 40;
  if (points.length < 2) {
    return (
      <div className="text-xs text-muted-foreground">
        {points.length === 0 ? "No suggestions yet." : "One data point so far."}
      </div>
    );
  }
  const rates = points.map((p) => p.rate);
  const min = 0;
  const max = 1;
  const stepX = W / (points.length - 1);
  const coords = rates
    .map((r, i) => {
      const x = i * stepX;
      const y = H - ((r - min) / (max - min)) * H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="text-emerald-300">
      <polyline points={coords} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default async function AnalyticsPage() {
  const user = await requireUser();
  const [recent, trend, topSongs, topScriptures, avgLen, detBreak] = await Promise.all([
    getRecentServices(user.churchId, 10),
    getAccuracyTrend(user.churchId, 30),
    getTopSongs(user.churchId, 10),
    getTopScriptures(user.churchId, 10),
    getAvgServiceLengthMs(user.churchId, 20),
    getDetectionBreakdown(user.churchId, 30),
  ]);

  const trendTotal = trend.reduce((a, p) => a + p.total, 0);
  const trendApproved = trend.reduce((a, p) => a + p.approved, 0);
  const overallRate = trendTotal > 0 ? Math.round((trendApproved / trendTotal) * 100) : null;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Insight"
        title="Analytics"
        description="Live signals from your services — content, accuracy, and durations."
      />

      <div className="grid gap-4 md:grid-cols-4">
        <Card label="Services (recent)" value={String(recent.length)} />
        <Card label="Median service length" value={formatDuration(avgLen)} />
        <Card label="Approval rate (30d)" value={overallRate == null ? "—" : `${overallRate}%`} />
        <Card label="Detections (30d)" value={String(detBreak.total)} />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Panel title="Accuracy trend (30 days)" subtitle={`${trendTotal} suggestions, ${trendApproved} approved`}>
          <Sparkline points={trend} />
          <div className="mt-2 text-xs text-muted-foreground">Approval rate per day (auto/manual/edited).</div>
        </Panel>

        <Panel title="Detection breakdown (30 days)" subtitle="scripture references detected in transcripts">
          <div className="grid grid-cols-3 gap-3 text-center">
            <MiniStat label="Pending" value={detBreak.pending} tone="amber" />
            <MiniStat label="Approved" value={detBreak.approved} tone="emerald" />
            <MiniStat label="Rejected" value={detBreak.rejected} tone="rose" />
          </div>
        </Panel>
      </div>

      <Panel title="Recent services" subtitle="last 10 by creation">
        {recent.length === 0 ? (
          <div className="text-sm text-muted-foreground">No services yet. Create one to start seeing analytics.</div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-white/8">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.03] text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Title</th>
                  <th className="px-3 py-2 text-right">Items</th>
                  <th className="px-3 py-2 text-right">Segments</th>
                  <th className="px-3 py-2 text-right">Duration</th>
                  <th className="px-3 py-2 text-right">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/8">
                {recent.map((s) => (
                  <tr key={s.id} className="hover:bg-white/[0.02]">
                    <td className="px-3 py-2">
                      <Link href={`/services/${s.id}`} className="hover:underline">{s.title}</Link>
                    </td>
                    <td className="px-3 py-2 text-right">{s.itemCount}</td>
                    <td className="px-3 py-2 text-right">{s.segmentCount}</td>
                    <td className="px-3 py-2 text-right">{formatDuration(s.durationMs)}</td>
                    <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                      {new Date(s.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid gap-6 md:grid-cols-2">
        <Panel title="Top songs" subtitle="most used across services">
          <List rows={topSongs.map((r) => ({ label: r.title, value: r.count }))} empty="No songs used yet." />
        </Panel>
        <Panel title="Top scriptures" subtitle="most used across services">
          <List rows={topScriptures.map((r) => ({ label: r.title, value: r.count }))} empty="No scripture items yet." />
        </Panel>
      </div>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-foreground">{value}</div>
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-5">
      <div className="mb-3">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone: "amber" | "emerald" | "rose" }) {
  const toneClass =
    tone === "amber" ? "text-amber-300" : tone === "emerald" ? "text-emerald-300" : "text-rose-300";
  return (
    <div className="rounded-lg border border-white/8 bg-black/20 p-3">
      <div className={`text-xl font-semibold ${toneClass}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function List({ rows, empty }: { rows: { label: string; value: number }[]; empty: string }) {
  if (rows.length === 0) return <div className="text-sm text-muted-foreground">{empty}</div>;
  return (
    <ul className="space-y-1.5">
      {rows.map((r, i) => (
        <li key={i} className="flex items-center justify-between text-sm">
          <span className="truncate pr-2 text-foreground/90">{r.label}</span>
          <span className="text-xs tabular-nums text-muted-foreground">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}
