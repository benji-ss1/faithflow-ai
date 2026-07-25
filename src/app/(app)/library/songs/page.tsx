import { redirect } from "next/navigation";
import { eq, and, inArray } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { getDb } from "@/lib/db/client";
import { migrationJobs } from "@/lib/db/schema";
import { listSongs } from "@/lib/server/services";
import { PageHeader } from "@/components/layout/PageHeader";
import { SongImporter } from "@/components/library/SongImporter";
import { InternetSongDetectionPanel } from "@/components/library/InternetSongDetectionPanel";
import { SongLicensingPanel } from "@/components/library/SongLicensingPanel";
import { SongBundlesPanel } from "@/components/library/SongBundlesPanel";
import { SongsTable } from "@/components/library/SongsTable";
import { getSongLimit, getSongUsage } from "@/lib/song-limits";
import { createSong } from "@/lib/actions";

async function create(formData: FormData) {
  "use server";
  const res = await createSong(formData);
  if (res.ok && res.data) redirect(`/library/songs/${res.data.id}`);
}

export default async function SongsPage() {
  const user = await requireUser();
  const db = getDb();
  const [songs, limit, usage, pendingImports] = await Promise.all([
    listSongs(user.churchId),
    getSongLimit(user.churchId),
    getSongUsage(user.churchId),
    db.select().from(migrationJobs).where(and(eq(migrationJobs.churchId, user.churchId), inArray(migrationJobs.status, ["pending", "processing"]))),
  ]);
  const importedCount = songs.filter((song) => song.source === "imported").length;
  const totalSources = new Set(songs.map((s) => s.source)).size;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Library"
        title="Songs"
        description="Manage your church-owned song library, imports, and licensing posture. PresentFlow does not bundle a global copyrighted worship-lyrics catalog."
        action={<SongImporter />}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Songs in Library" value={String(songs.length)} hint="Ready to use" />
        <StatCard label="Song Limit" value={`${usage}/${limit}`} hint={usage >= limit ? "Buy a bundle for more room" : "Free + purchased bundles"} />
        <StatCard label="Pending Imports" value={String(pendingImports.length)} hint={pendingImports.length === 0 ? "No imports in progress" : "Awaiting processing"} />
        <StatCard label="Total Sources" value={String(totalSources)} hint="Distinct song origins" />
      </div>

      <SongBundlesPanel usage={usage} limit={limit} />

      <SongLicensingPanel songCount={songs.length} importedCount={importedCount} />

      {/* Section 8 (visual-overhaul brief): the detection testing panel is
          a power-user tool for tuning AI song-matching against the local
          library. Volunteers running Sunday services don't need to see it
          on the Songs page every time. Hidden behind a `<details>` toggle
          labelled "Admin / Debug" so it's still one click away for the
          admin who tunes it, but doesn't crowd the everyday view. */}
      <details className="group rounded-2xl border border-border bg-card/40 open:bg-card/80 open:shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between rounded-2xl px-5 py-3 text-sm font-medium text-muted-foreground transition hover:bg-card/60 hover:text-foreground">
          <span className="flex items-center gap-2">
            <span className="inline-flex items-center rounded bg-[var(--pf-admin-bg-muted)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--pf-admin-text-muted)]">
              Admin · Debug
            </span>
            Detection testing panel
          </span>
          <span className="text-[11px] text-muted-foreground group-open:hidden">Show</span>
          <span className="hidden text-[11px] text-muted-foreground group-open:inline">Hide</span>
        </summary>
        <div className="border-t border-border p-5">
          <InternetSongDetectionPanel totalSongs={songs.length} />
        </div>
      </details>
      <form action={create} className="mb-6 flex flex-wrap gap-2 rounded-2xl border border-border bg-card/80 p-4">
        <input name="title" placeholder="Song title" required
          className="h-10 max-w-xs flex-1 rounded-xl border border-border bg-background px-3 text-sm" />
        <input name="artist" placeholder="Artist (optional)"
          className="h-10 max-w-xs flex-1 rounded-xl border border-border bg-background px-3 text-sm" />
        <button className="h-10 rounded-xl bg-foreground px-4 text-sm font-semibold text-background">Create</button>
      </form>
      <SongsTable
        songs={songs.map((s) => ({
          id: s.id,
          title: s.title,
          artist: s.artist,
          source: s.source,
        }))}
      />

    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card/90 p-4">
      <div className="text-2xl font-bold">{value}</div>
      <div className="mt-1 text-sm font-medium">{label}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}
