import Link from "next/link";
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
      <InternetSongDetectionPanel totalSongs={songs.length} />
      <form action={create} className="mb-6 flex flex-wrap gap-2 rounded-2xl border border-border bg-card/80 p-4">
        <input name="title" placeholder="Song title" required
          className="h-10 max-w-xs flex-1 rounded-xl border border-border bg-background px-3 text-sm" />
        <input name="artist" placeholder="Artist (optional)"
          className="h-10 max-w-xs flex-1 rounded-xl border border-border bg-background px-3 text-sm" />
        <button className="h-10 rounded-xl bg-foreground px-4 text-sm font-semibold text-background">Create</button>
      </form>
      {songs.length === 0 ? (
        <div className="text-sm text-muted-foreground">No songs yet.</div>
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-border">
          {songs.map((s) => (
            <li key={s.id} className="flex items-center justify-between border-b border-border p-4 last:border-b-0">
              <Link href={`/library/songs/${s.id}`} className="font-medium hover:underline">
                {s.title}{s.artist && <span className="ml-2 text-xs text-muted-foreground">— {s.artist}</span>}
              </Link>
              <div className="flex items-center gap-2">
                <span className={`rounded-full border px-2.5 py-1 text-[11px] ${s.source === "public_domain" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300" : s.source === "imported" ? "border-amber-500/20 bg-amber-500/10 text-amber-300" : "border-white/10 bg-white/[0.03] text-muted-foreground"}`}>
                  {s.source === "public_domain" ? "Public domain" : s.source === "imported" ? "Imported" : "Church-owned"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
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
